import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', 'alvien-server', '.env')

const envVars = {}
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const match = line.match(/^(\w+)=(.+)$/)
  if (match) envVars[match[1]] = match[2]
}

const FIRECRAWL_KEY = envVars.FIRECRAWL_API_KEY || process.env.FIRECRAWL_API_KEY
const GROQ_KEY = envVars.GROQ_API_KEY || process.env.GROQ_API_KEY
const TARGET_URL = process.argv[2] || 'https://linear.app'

if (!FIRECRAWL_KEY || !GROQ_KEY) {
  console.error('Missing FIRECRAWL_API_KEY or GROQ_API_KEY in .env')
  process.exit(1)
}

async function scrapePage(url) {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true })
  })
  const data = await res.json()
  if (!data.success) return null
  return data.data.markdown
}

async function scrapePages(baseUrl) {
  const urls = [baseUrl]
  for (const p of ['/about', '/pricing', '/blog', '/features']) {
    try {
      const u = new URL(p, baseUrl)
      if (u.href !== baseUrl) urls.push(u.href)
    } catch {}
  }
  const results = await Promise.allSettled(urls.map(url => scrapePage(url)))
  let combined = ''
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled' && r.value) {
      combined += `\n## PAGE: ${urls[i]}\n${r.value}\n`
    }
  }
  return combined || (() => { throw new Error('All pages failed') })()
}

async function runDebate(siteContent, siteUrl) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
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
- Name failure patterns when you see them.
- Push once, then push again. The first answer is the polished version.`
        },
        {
          role: 'user',
          content: `Analyze this website as if you are Garry Tan running YC office hours on the business behind it.

URL: ${siteUrl}

SITE CONTENT:
${siteContent.slice(0, 8000)}

Run a 3-round pressure test between a Protagonist and an Antagonist (YC partner voice), then deliver a structured verdict.

Return ONLY this JSON structure, exactly:
{
  "executive_summary": "string",
  "protagonist_opening": "string",
  "antagonist_demand": "string",
  "protagonist_rebuttal": "string",
  "antagonist_status_quo": "string",
  "protagonist_final": "string",
  "antagonist_wedge": "string",
  "verdict_demand_risk": "string",
  "verdict_wedge_risk": "string",
  "verdict_status_quo_risk": "string",
  "verdict_differentiation_risk": "string",
  "recommendations": ["string", "string", "string"]
}`
        }
      ]
    })
  })

  const json = await res.json()
  const raw = json.choices?.[0]?.message?.content
  if (!raw) throw new Error('Groq returned no content')

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
                <tr><td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:8px">DEMAND RISK</td></tr>
                <tr><td style="font-family:Georgia,serif;font-size:14px;line-height:1.7;color:#e0e0e0">${debate.verdict_demand_risk}</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1a1a;border-left:3px solid #C9A84C;padding:24px;margin:32px 0;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:8px">WEDGE RISK</td></tr>
                <tr><td style="font-family:Georgia,serif;font-size:14px;line-height:1.7;color:#e0e0e0">${debate.verdict_wedge_risk}</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1a1a;border-left:3px solid #C9A84C;padding:24px;margin:32px 0;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:8px">STATUS QUO RISK</td></tr>
                <tr><td style="font-family:Georgia,serif;font-size:14px;line-height:1.7;color:#e0e0e0">${debate.verdict_status_quo_risk}</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1a1a;border-left:3px solid #C9A84C;padding:24px;margin:32px 0;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:8px">DIFFERENTIATION RISK</td></tr>
                <tr><td style="font-family:Georgia,serif;font-size:14px;line-height:1.7;color:#e0e0e0">${debate.verdict_differentiation_risk}</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1a1a;border-left:3px solid #C9A84C;padding:24px;margin:32px 0;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#C9A84C;padding-bottom:16px">RECOMMENDATIONS</td></tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${recItems}</table>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #2a2a2a;padding-top:32px;margin-top:40px;display:block">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.15em;color:#888;padding-bottom:24px">FULL DEBATE TRANSCRIPT</td></tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr><td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#4CAF50;padding-bottom:8px">PROTAGONIST — OPENING CASE</td></tr>
                <tr><td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.protagonist_opening}</td></tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr><td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#E88C30;padding-bottom:8px">ANTAGONIST (YC PARTNER) — DEMAND CHALLENGE</td></tr>
                <tr><td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.antagonist_demand}</td></tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr><td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#4CAF50;padding-bottom:8px">PROTAGONIST — REBUTTAL</td></tr>
                <tr><td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.protagonist_rebuttal}</td></tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr><td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#E88C30;padding-bottom:8px">ANTAGONIST (YC PARTNER) — STATUS QUO CHALLENGE</td></tr>
                <tr><td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.antagonist_status_quo}</td></tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr><td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#4CAF50;padding-bottom:8px">PROTAGONIST — FINAL CASE</td></tr>
                <tr><td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.protagonist_final}</td></tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr><td style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.1em;color:#E88C30;padding-bottom:8px">ANTAGONIST (YC PARTNER) — WEDGE VERDICT</td></tr>
                <tr><td style="font-family:Georgia,serif;font-size:14px;line-height:1.8;color:#ccc;border-left:2px solid #2a2a2a;padding-left:16px">${debate.antagonist_wedge}</td></tr>
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

const domain = new URL(TARGET_URL).hostname.replace(/^www\./, '').replace(/\./g, '-')
const outputPath = resolve(__dirname, '..', `sample-report-${domain}.html`)

console.log(`Scraping ${TARGET_URL}...`)
const content = await scrapePages(TARGET_URL)
console.log('Scrape complete. Running debate...')
const debate = await runDebate(content, TARGET_URL)
console.log('Debate complete. Formatting...')
const html = formatEmail(debate, TARGET_URL)
writeFileSync(outputPath, html, 'utf-8')
console.log(`Sample report saved to ${outputPath}`)
