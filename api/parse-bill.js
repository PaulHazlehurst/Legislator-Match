// /api/parse-bill.js
// Classifies a bill from title/text/PDF using topic guidance stored in data.json.
// Reads guidance dynamically so it stays accurate as taxonomy evolves.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, pdfBase64, knownTopics } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
  if (!text && !pdfBase64) return res.status(400).json({ error: 'Provide either text or pdfBase64.' });

  // Build topic guidance dynamically from data.json's guidance fields
  const topicList = Object.entries(knownTopics || {}).map(([code, t]) => {
    const subs = Object.entries(t.subtopics || {}).map(([sc, sl]) => `  • ${sc}: ${sl}`).join('\n');
    const g = t.guidance || {};
    return [
      `TOPIC: ${code} — "${t.label}"`,
      g.includes ? `  Includes: ${g.includes}` : '',
      g.excludes ? `  Does NOT include: ${g.excludes}` : '',
      subs ? `  Subtopics:\n${subs}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const systemPrompt = `You extract structured data about a state legislative bill for a professional lobbying firm. Accurate classification is critical — it directly affects which legislators get recommended to clients.

${topicList ? `THE AVAILABLE TOPICS:\n\n${topicList}\n\n` : ''}CRITICAL RULES:
1. Only match a topic if the bill CLEARLY belongs there based on its actual policy content.
2. A bill affecting a particular population (veterans, seniors, teachers) does NOT automatically belong in any topic — what matters is what the bill actually DOES.
3. If confident about a topic, say so. If uncertain, return null — the user will classify manually.
4. Do NOT invent a sponsor name if none is mentioned.

Respond with ONLY a JSON object, no markdown fences:
{
  "title": "the bill's official or best-guess title",
  "year": number or null,
  "topicMatch": "existing topic code or null",
  "subtopicMatch": "existing subtopic code or null",
  "confidence": "high" | "low" | null,
  "suggestedTopicLabel": "short label for a clearly new topic area, otherwise null",
  "suggestedSubtopicLabel": "short label for a clearly new subtopic, otherwise null",
  "sponsorName": "primary sponsor name if mentioned, otherwise null",
  "reasoning": "one sentence explaining the classification or why you returned null"
}`;

  const userContent = [];
  if (pdfBase64) {
    userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } });
    userContent.push({ type: 'text', text: 'Extract the bill fields from this PDF.' });
  } else {
    userContent.push({ type: 'text', text: `Extract the bill fields from this: ${text}` });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 600, system: systemPrompt, messages: [{ role: 'user', content: userContent }] })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Anthropic API error: ${errText}` });
    }

    const data = await response.json();
    const rawText = data.content.find(b => b.type === 'text')?.text || '{}';
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { return res.status(502).json({ error: 'Could not parse AI response as JSON.' }); }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
