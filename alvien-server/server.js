import express from 'express'
import Stripe from 'stripe'
import { Resend } from 'resend'
import Groq from 'groq-sdk'

const app = express()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const resend = new Resend(process.env.RESEND_API_KEY)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

async function scrapeSite(url) {
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
    })
  })
  const data = await res.json()
  if (!data.success) throw new Error('Firecrawl failed')
  return data.data.markdown
}

async function runDebate(siteContent, siteUrl) {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.1-70b-versatile',
    temperature: 0.7,
    max_tokens: 4000,
    messages: [
      {
        role: 'system',
        content: `You are a business strategy debate engine. You output only valid JSON, no markdown, no explanation, no backticks.`
      },
      {
        role: 'user',
        content: `Analyze this website and run a structured pressure test debate.

URL: ${siteUrl}

SITE CONTENT:
${siteContent.slice(0, 6000)}

Run a 3-round debate between an Advocate and an Antagonist then deliver a verdict.

The Advocate builds the strongest possible case for this business: positioning, value prop, target market, trust signals, conversion strength.

The Antagonist attacks like a skeptical investor: challenges differentiation, market size, pricing logic, messaging clarity, missing proof points.

Return ONLY this JSON structure, nothing else:
{
  "advocate_opening": "string",
  "antagonist_round1": "string",
  "advocate_rebuttal": "string",
  "antagonist_round2": "string",
  "advocate_final": "string",
  "antagonist_final": "string",
  "verdict_survived": ["string", "string", "string"],
  "verdict_exposed": ["string", "string", "string"],
  "recommendations": ["string", "string", "string"]
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

function formatEmail(debate, siteUrl) {
  const domain = new URL(siteUrl).hostname
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { background: #0D0D0D; color: #F5F4F0; font-family: Georgia, serif; margin: 0; padding: 0; }
    .container { max-width: 680px; margin: 0 auto; padding: 40px 24px; }
    .header { border-bottom: 1px solid #C9A84C; padding-bottom: 24px; margin-bottom: 32px; }
    .brand { font-size: 24px; color: #C9A84C; letter-spacing: 0.1em; }
    .domain { font-size: 13px; color: #888; margin-top: 4px; }
    .verdict-section { background: #1a1a1a; border-left: 3px solid #C9A84C; padding: 24px; margin-bottom: 32px; border-radius: 4px; }
    .verdict-title { font-size: 11px; letter-spacing: 0.15em; color: #C9A84C; margin-bottom: 16px; }
    .verdict-list { list-style: none; padding: 0; margin: 0; }
    .verdict-list li { padding: 8px 0; border-bottom: 1px solid #2a2a2a; font-size: 14px; line-height: 1.6; }
    .verdict-list li:last-child { border-bottom: none; }
    .survived li::before { content: "\\2713 "; color: #4CAF50; }
    .exposed li::before { content: "\\26A0 "; color: #E88C30; }
    .recs li::before { content: "\\2192 "; color: #C9A84C; }
    .debate-section { margin-top: 40px; border-top: 1px solid #2a2a2a; padding-top: 32px; }
    .debate-title { font-size: 11px; letter-spacing: 0.15em; color: #888; margin-bottom: 24px; }
    .round { margin-bottom: 24px; }
    .speaker { font-size: 11px; letter-spacing: 0.1em; margin-bottom: 8px; }
    .advocate-label { color: #4CAF50; }
    .antagonist-label { color: #E88C30; }
    .speech { font-size: 14px; line-height: 1.8; color: #ccc; border-left: 2px solid #2a2a2a; padding-left: 16px; }
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #2a2a2a; font-size: 12px; color: #555; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">ALVIEN</div>
      <div class="domain">Report for ${domain}</div>
    </div>

    <div class="verdict-section">
      <div class="verdict-title">WHAT SURVIVED THE PRESSURE TEST</div>
      <ul class="verdict-list survived">
        ${debate.verdict_survived.map(s => `<li>${s}</li>`).join('')}
      </ul>
    </div>

    <div class="verdict-section">
      <div class="verdict-title">STILL EXPOSED</div>
      <ul class="verdict-list exposed">
        ${debate.verdict_exposed.map(e => `<li>${e}</li>`).join('')}
      </ul>
    </div>

    <div class="verdict-section">
      <div class="verdict-title">TOP RECOMMENDATIONS</div>
      <ul class="verdict-list recs">
        ${debate.recommendations.map(r => `<li>${r}</li>`).join('')}
      </ul>
    </div>

    <div class="debate-section">
      <div class="debate-title">FULL DEBATE TRANSCRIPT</div>

      <div class="round">
        <div class="speaker advocate-label">ADVOCATE — OPENING</div>
        <div class="speech">${debate.advocate_opening}</div>
      </div>

      <div class="round">
        <div class="speaker antagonist-label">ANTAGONIST — ROUND 1</div>
        <div class="speech">${debate.antagonist_round1}</div>
      </div>

      <div class="round">
        <div class="speaker advocate-label">ADVOCATE — REBUTTAL</div>
        <div class="speech">${debate.advocate_rebuttal}</div>
      </div>

      <div class="round">
        <div class="speaker antagonist-label">ANTAGONIST — ROUND 2</div>
        <div class="speech">${debate.antagonist_round2}</div>
      </div>

      <div class="round">
        <div class="speaker advocate-label">ADVOCATE — FINAL</div>
        <div class="speech">${debate.advocate_final}</div>
      </div>

      <div class="round">
        <div class="speaker antagonist-label">ANTAGONIST — FINAL</div>
        <div class="speech">${debate.antagonist_final}</div>
      </div>
    </div>

    <div class="footer">
      Generated by Alvien — AI Business Intelligence for Agencies<br>
      alvien.ai
    </div>
  </div>
</body>
</html>`
}

async function sendReport(customerEmail, debate, siteUrl) {
  const domain = new URL(siteUrl).hostname
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: customerEmail,
    subject: `Your Alvien Report — ${domain}`,
    html: formatEmail(debate, siteUrl)
  })
}

async function runPipeline(customerEmail, websiteUrl) {
  try {
    console.log(`Starting pipeline for ${customerEmail} — ${websiteUrl}`)
    const siteContent = await scrapeSite(websiteUrl)
    console.log('Scrape complete')
    const debate = await runDebate(siteContent, websiteUrl)
    console.log('Debate complete')
    await sendReport(customerEmail, debate, websiteUrl)
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

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).send('Ignored')
  }

  const session = event.data.object
  const customerEmail = session.customer_details.email
  const customFields = session.custom_fields || []
  const websiteUrl = customFields.find(f => f.key === 'websiteurltoaudit')?.text?.value

  res.status(200).send('OK')

  if (customerEmail && websiteUrl) {
    runPipeline(customerEmail, websiteUrl)
  }
})

app.get('/health', (req, res) => res.send('Alvien pipeline live'))

app.listen(process.env.PORT || 3000, () => {
  console.log('Alvien server running on port', process.env.PORT || 3000)
})
