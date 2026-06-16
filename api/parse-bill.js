// /api/parse-bill.js
// Takes either { text: "bill title or description" } or { pdfBase64: "..." }
// plus { knownTopics: {...} } describing valid topic/subtopic codes,
// and returns structured fields extracted by Claude.

export default async function handler(req, res) {
  // CORS — allow your GitHub Pages site to call this function
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, pdfBase64, knownTopics } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Set it in Vercel project settings.' });
  }
  if (!text && !pdfBase64) {
    return res.status(400).json({ error: 'Provide either text or pdfBase64.' });
  }

  const topicList = Object.entries(knownTopics || {}).map(([code, t]) => {
    const subs = Object.entries(t.subtopics || {}).map(([sc, sl]) => `${sc} (${sl})`).join(', ');
    return `- ${code} (${t.label}): subtopics = ${subs}`;
  }).join('\n');

  const systemPrompt = `You extract structured data about a state legislative bill from a title, description, or PDF the user provides.

The existing topics and subtopics in this system are:
${topicList || '(none yet)'}

Respond with ONLY a JSON object, no other text, no markdown fences. Use this exact shape:
{
  "title": "string, the bill's official or best-guess title",
  "year": number or null,
  "topicMatch": "one of the existing topic codes above if one fits well, otherwise null",
  "subtopicMatch": "one of that topic's existing subtopic codes if one fits well, otherwise null",
  "suggestedTopicLabel": "if no existing topic fits well, a short human-readable label for a NEW topic this bill belongs to (e.g. 'Insurance'), otherwise null",
  "suggestedSubtopicLabel": "if no existing subtopic fits well, a short human-readable label for a NEW subtopic under the matched or suggested topic (e.g. 'Auto insurance'), otherwise null",
  "sponsorName": "string or null, the primary sponsor's name if mentioned"
}

Prefer matching an existing topic/subtopic over suggesting a new one whenever the fit is reasonable. Only suggest a new topic or subtopic when the bill clearly doesn't belong under any existing one. Do not invent a sponsor name if none is mentioned.`;

  const userContent = [];
  if (pdfBase64) {
    userContent.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
    });
    userContent.push({ type: 'text', text: 'Extract the bill fields from this PDF.' });
  } else {
    userContent.push({ type: 'text', text: `Extract the bill fields from this: ${text}` });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Anthropic API error: ${errText}` });
    }

    const data = await response.json();
    const rawText = data.content.find(b => b.type === 'text')?.text || '{}';
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: 'Could not parse AI response as JSON.' });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
