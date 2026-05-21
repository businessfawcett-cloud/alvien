import 'dotenv/config'
import express from 'express'
import Stripe from 'stripe'
import { Resend } from 'resend'
import Groq from 'groq-sdk'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const app = express()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const resend = new Resend(process.env.RESEND_API_KEY)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const CREDITS_FILE = './credits.json'

function loadCredits() {
  if (!existsSync(CREDITS_FILE)) return {}
  return JSON.parse(readFileSync(CREDITS_FILE, 'utf-8'))
}

function saveCredits(store) {
  writeFileSync(CREDITS_FILE, JSON.stringify(store, null, 2))
}

function assignCredits(email, plan, subscriptionId) {
  const store = loadCredits()
  store[email] = { credits: plan === 'cohort' ? 50 : 10, plan, subscriptionId }
  saveCredits(store)
}

function deductCredit(email) {
  const store = loadCredits()
  if (store[email] && store[email].credits > 0) {
    store[email].credits--
    saveCredits(store)
    return true
  }
  return false
}

function resetMonthlyCredits(email) {
  const store = loadCredits()
  if (store[email]) {
    store[email].credits = store[email].plan === 'cohort' ? 50 : 10
    saveCredits(store)
  }
}

function getCredits(email) {
  const store = loadCredits()
  return store[email]?.credits ?? 0
}

async function scrapeSinglePage(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true
      }),
      signal: controller.signal
    })
    const data = await res.json()
    if (!data.success) return null
    return data.data.markdown
  } finally {
    clearTimeout(timeout)
  }
}

async function scrapePages(baseUrl) {
  const urls = [baseUrl]
  const paths = ['/about', '/pricing', '/blog']
  for (const p of paths) {
    try {
      const u = new URL(p, baseUrl)
      if (u.href !== baseUrl) urls.push(u.href)
    } catch {}
  }
  let combined = ''
  for (const url of urls) {
    try {
      const content = await scrapeSinglePage(url)
      if (content) combined += `\n## PAGE: ${url}\n${content}\n`
    } catch (e) {
      console.warn(`Failed to scrape ${url}:`, e.message)
    }
    await new Promise(r => setTimeout(r, 200))
  }
  if (!combined) throw new Error('Firecrawl failed for all pages')
  return combined
}

async function runDebate(siteContent, siteUrl, competitorContent) {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    temperature: 0.7,
    max_tokens: 4000,
    messages: [
      {
        role: 'system',
        content: `You are a YC office-hours partner analyzing a website. You output only valid JSON, no markdown, no explanation, no backticks.

Voice rules:
- Direct to the point of discomfort. Short sentences. Active voice.
- No corporate language. No "it appears that," "one might consider," "it could be argued."
- Name failure patterns when you see them: "solution in search of a problem," "interest is not demand," "wedge too wide."
- Push once, then push again. The first answer is the polished version.`
      },
      {
        role: 'user',
        content: `Analyze this website as if you are Garry Tan running YC office hours on the business behind it.

URL: ${siteUrl}

SITE CONTENT:
${siteContent.slice(0, 40000)}
${competitorContent ? `
COMPETITOR REFERENCE:
${competitorContent.slice(0, 15000)}

The user wants to understand how they compare to this competitor. Include a competitive assessment in the antagonist rounds and differentiation verdict.` : ''}

Run a 3-round pressure test between a Protagonist and an Antagonist (YC partner voice), then deliver a structured verdict.

The Protagonist extracts everything the site claims and builds the strongest possible case — positioning, value prop, target user, traction signals, trust elements, conversion strength.

The Antagonist (Garry Tan / YC partner) pushes on the six YC forcing questions:
- Demand Reality: What evidence exists that someone actually needs this? Not interest. Not waitlists. Behavior that proves it.
- Status Quo: What were they doing before this? What does that workaround cost them in time, money, or frustration?
- Specific User: Name the actual human. What's their title? What gets them promoted? What gets them fired?
- Wedge: What's the smallest version someone would pay for this week? Not the platform — the wedge.
- Observation: What would watching a user reveal that the site claims don't show?
- Future Fit: If the world changes, does this become more essential or less?

Return ONLY this JSON structure, exactly:
{
  "executive_summary": "One-paragraph bottom line — should they worry? What survived, what's exposed, what to do. Write this as a partner speaking directly to the founder.",
  "protagonist_opening": "Extract and build the site's strongest claims — positioning, target, value prop, traction, trust signals",
  "antagonist_demand": "YC partner diagnosis of the demand evidence gap — what's real vs what's assumed",
  "protagonist_rebuttal": "Defend with specific site evidence the antagonist missed",
  "antagonist_status_quo": "YC partner on the real competitor (the workaround) and what it costs the user",
  "protagonist_final": "The final case for this business based on everything the site reveals",
  "antagonist_wedge": "YC partner on who specifically needs this and what the smallest version worth paying for actually is",
  "verdict_demand_risk": "Assessment of whether the site proves real demand vs hypothetical interest. 2-3 sentences.",
  "verdict_wedge_risk": "Assessment of how clearly the site defines its specific user and the smallest valuable offer. 2-3 sentences.",
  "verdict_status_quo_risk": "Assessment of whether the problem is painful enough to act on. 2-3 sentences.",
  "verdict_differentiation_risk": "Assessment of how the site differentiates from the workaround and alternatives. 2-3 sentences.",
  "recommendations": ["Actionable recommendation based on site content", "Second recommendation", "Third recommendation"]
}`
      }
    ]
  })

  const raw = completion.choices[0].message.content
  try {
    return JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('Could not parse debate JSON')
  }
}

function formatEmail(debate, siteUrl, agencyName) {
  const domain = new URL(siteUrl).hostname
  const recItems = debate.recommendations.map(r =>
    `<tr><td style="padding:8px 0 8px 20px;border-bottom:1px solid #2a2a2a;font-size:14px;line-height:1.6;color:#e0e0e0;font-family:Georgia,serif">&#8594; ${r}</td></tr>`
  ).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#0D0D0D">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0D0D0D">
    <tr>
      <td align="center" style="padding:40px 16px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px">

          <tr>
            <td style="border-bottom:1px solid #C9A84C;padding-bottom:24px">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:24px;color:#C9A84C;letter-spacing:0.1em">ALVIEN — YC OFFICE HOURS REPORT</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:13px;color:#888;padding-top:4px">Pressure test for ${domain}</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="border-left:3px solid #C9A84C;padding:0 0 24px 24px;margin:24px 0 32px;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#e0e0e0;font-style:italic">${debate.executive_summary}</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#1a1a1a;border-left:3px solid #C9A84C;padding:24px;margin:32px 0;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:8px">DEMAND RISK</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.7;color:#e0e0e0">${debate.verdict_demand_risk}</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#1a1a1a;border-left:3px solid #C9A84C;padding:24px;margin:32px 0;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:8px">WEDGE RISK</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.7;color:#e0e0e0">${debate.verdict_wedge_risk}</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#1a1a1a;border-left:3px solid #C9A84C;padding:24px;margin:32px 0;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:8px">STATUS QUO RISK</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.7;color:#e0e0e0">${debate.verdict_status_quo_risk}</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#1a1a1a;border-left:3px solid #C9A84C;padding:24px;margin:32px 0;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:8px">DIFFERENTIATION RISK</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.7;color:#e0e0e0">${debate.verdict_differentiation_risk}</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#1a1a1a;border-left:3px solid #C9A84C;padding:24px;margin:32px 0;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:16px">RECOMMENDATIONS</td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${recItems}
              </table>
            </td>
          </tr>

          <tr>
            <td style="border-top:1px solid #2a2a2a;padding-top:32px;margin-top:40px;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#888;padding-bottom:24px">FULL DEBATE TRANSCRIPT</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#4CAF50;padding-bottom:8px">PROTAGONIST — OPENING CASE</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.protagonist_opening}</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#E88C30;padding-bottom:8px">ANTAGONIST (YC PARTNER) — DEMAND CHALLENGE</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.antagonist_demand}</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#4CAF50;padding-bottom:8px">PROTAGONIST — REBUTTAL</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.protagonist_rebuttal}</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#E88C30;padding-bottom:8px">ANTAGONIST (YC PARTNER) — STATUS QUO CHALLENGE</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.antagonist_status_quo}</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#4CAF50;padding-bottom:8px">PROTAGONIST — FINAL CASE</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.protagonist_final}</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#E88C30;padding-bottom:8px">ANTAGONIST (YC PARTNER) — WEDGE VERDICT</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.antagonist_wedge}</td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td style="padding-top:24px;margin-top:48px;border-top:1px solid #2a2a2a;font-family:Georgia,serif;font-size:12px;color:#555">
              ${agencyName ? `Prepared exclusively for ${domain} by ${agencyName}<br><br>` : ''}
              Generated by Alvien — AI Business Intelligence for Agencies<br>
              alvien.ai
            </td>
          </tr>
          <tr>
            <td style="font-family:Georgia,serif;font-size:8px;color:#555;padding-top:16px;text-align:center;padding-bottom:24px">
              Disclaimer: This report is generated by Artificial Intelligence based on publicly available website data. It is for strategic brainstorming purposes only and does not constitute financial, legal, or professional business advice.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

async function generatePdfFromHtml(html) {
  const postController = new AbortController()
  const postTimeout = setTimeout(() => postController.abort(), 30000)
  let data
  try {
    const res = await fetch('https://v2.api2pdf.com/chromium/pdf', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.API2PDF_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ html }),
      signal: postController.signal
    })
    data = await res.json()
  } finally {
    clearTimeout(postTimeout)
  }
  const pdfUrl = data.FileUrl
  if (!pdfUrl) throw new Error('Api2Pdf failed')
  const dlController = new AbortController()
  const dlTimeout = setTimeout(() => dlController.abort(), 30000)
  try {
    const pdfRes = await fetch(pdfUrl, { signal: dlController.signal })
    return Buffer.from(await pdfRes.arrayBuffer())
  } finally {
    clearTimeout(dlTimeout)
  }
}

async function sendReport(customerEmail, debate, siteUrl, agencyName) {
  const domain = new URL(siteUrl).hostname
  const html = formatEmail(debate, siteUrl, agencyName)
  let pdfBuffer
  try {
    pdfBuffer = await generatePdfFromHtml(html)
  } catch (err) {
    console.error('PDF generation failed, sending HTML only:', err.message)
  }
  const execSummary = debate.executive_summary || ''
  const teaser = execSummary
    ? `<p style="font-family:Georgia;font-size:14px;line-height:1.7;color:#e0e0e0;font-style:italic;margin-bottom:24px">${execSummary}</p>`
    : ''
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: customerEmail,
    subject: `Your Alvien Report — ${domain}`,
    html: `<div style="background:#0D0D0D;padding:40px 16px">
<div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#e0e0e0">
<p style="font-size:20px;color:#C9A84C;letter-spacing:0.1em;margin-bottom:4px">ALVIEN — REPORT READY</p>
<p style="color:#888;font-size:13px;margin-bottom:28px">Pressure test for ${domain}</p>
${teaser}
<p style="font-size:14px;line-height:1.7;color:#e0e0e0">Your full report${pdfBuffer ? ' is attached as a PDF' : ''} — ready to share, forward, or take into a pitch.</p>
${agencyName ? `<p style="font-size:12px;color:#C9A84C;margin-top:24px">Prepared by ${agencyName}</p>` : ''}
<p style="font-size:12px;color:#555;margin-top:32px">Generated by Alvien — AI Business Intelligence for Agencies</p>
</div></div>`,
    attachments: pdfBuffer
      ? [{ filename: `${domain}-alvien-report.pdf`, content: pdfBuffer }]
      : undefined
  })
}

const BLOCKED_DOMAINS = [
  'amazon.com', 'apple.com', 'google.com', 'microsoft.com',
  'facebook.com', 'youtube.com', 'wikipedia.org', 'amazonaws.com',
  'canva.com', 'vercel.com', 'netlify.com', 'godaddy.com',
  'wordpress.com', 'wix.com', 'squarespace.com',
]

function validateUrl(raw) {
  let url = raw
  if (!url.startsWith('http')) url = 'https://' + url
  const parsed = new URL(url)
  const domain = parsed.hostname.replace(/^www\./, '')
  if (BLOCKED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
    throw new Error(`Domain ${domain} is not allowed`)
  }
  return url
}

async function runPipeline(customerEmail, websiteUrl, competitorUrl, agencyName) {
  try {
    websiteUrl = validateUrl(websiteUrl)
    if (competitorUrl) competitorUrl = validateUrl(competitorUrl)
    console.log(`Starting pipeline for ${customerEmail} — ${websiteUrl}`)
    const [siteContent, competitorContent] = await Promise.all([
      scrapePages(websiteUrl),
      competitorUrl ? scrapeSinglePage(competitorUrl) : Promise.resolve(null)
    ])
    console.log('Scrape complete' + (competitorContent ? ' (with competitor)' : ''))
    const debate = await runDebate(siteContent, websiteUrl, competitorContent)
    console.log('Debate complete')
    await sendReport(customerEmail, debate, websiteUrl, agencyName)
    console.log('Report sent to', customerEmail)
  } catch (err) {
    console.error('Pipeline failed:', err)
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to: customerEmail,
        subject: 'Issue with your Alvien report',
        html: `<p style="font-family:Georgia;color:#333">We hit a technical issue generating your report for ${websiteUrl}. We're on it — reply to this email and we'll sort it within the hour.</p>`
      })
    } catch (emailErr) {
      console.error('Failed to send error email:', emailErr)
    }
  }
}

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error('Signature failed:', err.message)
    return res.status(400).send('Webhook Error')
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const customerEmail = session.customer_details.email
    const customFields = session.custom_fields || []
    let websiteUrl = customFields.find(f => f.key === 'website_url_to_audit')?.text?.value
    if (websiteUrl && !websiteUrl.startsWith('http')) {
      websiteUrl = 'https://' + websiteUrl
    }
    let competitorUrl = customFields.find(f => f.key === 'competitor_url')?.text?.value
    if (competitorUrl && !competitorUrl.startsWith('http')) {
      competitorUrl = 'https://' + competitorUrl
    }
    let agencyName = customFields.find(f => f.key === 'agency_name')?.text?.value

    if (session.mode === 'subscription') {
      const plan = session.amount_subtotal >= 50000 ? 'cohort' : 'agency'
      assignCredits(customerEmail, plan, session.subscription)
      console.log(`Assigned ${plan} credits to ${customerEmail}`)
    }

    res.status(200).send('OK')

    if (customerEmail && websiteUrl) {
      if (session.mode === 'subscription') {
        const creds = getCredits(customerEmail)
        if (creds > 0) {
          runPipeline(customerEmail, websiteUrl, competitorUrl, agencyName)
          deductCredit(customerEmail)
          console.log(`Credit deducted for ${customerEmail}, ${creds - 1} remaining`)
        } else {
          console.log(`No credits remaining for ${customerEmail}`)
        }
      } else {
        runPipeline(customerEmail, websiteUrl, competitorUrl, agencyName)
      }
    }
    return
  }

  if (event.type === 'invoice.paid') {
    const invoice = event.data.object
    if (invoice.billing_reason === 'subscription_cycle') {
      const email = invoice.customer_email || invoice.customer_details?.email
      if (email) {
        resetMonthlyCredits(email)
        console.log(`Monthly credits reset for ${email}`)
      }
    }
    return res.status(200).send('OK')
  }

  res.status(200).send('Ignored')
})

app.get('/health', (req, res) => res.send('Alvien pipeline live'))

app.listen(process.env.PORT || 3000, () => {
  console.log('Alvien server running on port', process.env.PORT || 3000)
})
