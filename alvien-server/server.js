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
    model: 'llama-3.3-70b-versatile',
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
  const survivedItems = debate.verdict_survived.map(s =>
    `<tr><td style="padding:8px 0 8px 20px;border-bottom:1px solid #2a2a2a;font-size:14px;line-height:1.6;color:#e0e0e0;font-family:Georgia,serif">&#10003; ${s}</td></tr>`
  ).join('')
  const exposedItems = debate.verdict_exposed.map(e =>
    `<tr><td style="padding:8px 0 8px 20px;border-bottom:1px solid #2a2a2a;font-size:14px;line-height:1.6;color:#e0e0e0;font-family:Georgia,serif">&#9888; ${e}</td></tr>`
  ).join('')
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
                  <td style="font-family:Georgia,serif;font-size:24px;color:#C9A84C;letter-spacing:0.1em">ALVIEN</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:13px;color:#888;padding-top:4px">Report for ${domain}</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#1a1a1a;border-left:3px solid #C9A84C;padding:24px;margin:32px 0;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:16px">WHAT SURVIVED THE PRESSURE TEST</td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${survivedItems}
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#1a1a1a;border-left:3px solid #C9A84C;padding:24px;margin:32px 0;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:16px">STILL EXPOSED</td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${exposedItems}
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#1a1a1a;border-left:3px solid #C9A84C;padding:24px;margin:32px 0;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:16px">TOP RECOMMENDATIONS</td>
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
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#4CAF50;padding-bottom:8px">ADVOCATE — OPENING</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.advocate_opening}</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#E88C30;padding-bottom:8px">ANTAGONIST — ROUND 1</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.antagonist_round1}</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#4CAF50;padding-bottom:8px">ADVOCATE — REBUTTAL</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.advocate_rebuttal}</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#E88C30;padding-bottom:8px">ANTAGONIST — ROUND 2</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.antagonist_round2}</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#4CAF50;padding-bottom:8px">ADVOCATE — FINAL</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.advocate_final}</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr>
                  <td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#E88C30;padding-bottom:8px">ANTAGONIST — FINAL</td>
                </tr>
                <tr>
                  <td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.antagonist_final}</td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td style="padding-top:24px;margin-top:48px;border-top:1px solid #2a2a2a;font-family:Georgia,serif;font-size:12px;color:#555">
              Generated by Alvien — AI Business Intelligence for Agencies<br>
              alvien.ai
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
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
  let websiteUrl = customFields.find(f => f.key === 'websiteurltoaudit')?.text?.value
  if (websiteUrl && !websiteUrl.startsWith('http')) {
    websiteUrl = 'https://' + websiteUrl
  }

  res.status(200).send('OK')

  if (customerEmail && websiteUrl) {
    runPipeline(customerEmail, websiteUrl)
  }
})

app.get('/health', (req, res) => res.send('Alvien pipeline live'))

app.listen(process.env.PORT || 3000, () => {
  console.log('Alvien server running on port', process.env.PORT || 3000)
})
