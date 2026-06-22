// /api/parse-bill.js
// Takes { text: "bill title or description" } or { pdfBase64: "..." }
// plus { knownTopics: {...} } and returns structured fields extracted by Claude.
// Uses the same rich topic guidance as the batch importer for consistency.

const TOPIC_GUIDANCE = {
  workforce: {
    includes: 'job training, apprenticeships, workforce development programs, employer hiring incentives, vocational education, skills training, labor market programs, career readiness, youth employment, unemployment insurance reform, job placement services',
    excludes: 'veterans benefits (even if veterans are mentioned as a population), disability accommodations, general economic development, business licensing, tax credits not specifically tied to hiring/employment'
  },
  healthcare: {
    includes: 'health insurance coverage, Medicaid/Medicare policy, hospital funding, mental health access, prescription drug policy, telehealth, nursing home standards, public health programs, health equity, patient rights',
    excludes: 'workplace safety (unless specifically about healthcare workers), veterinary medicine, health-related tax credits that are primarily fiscal policy, general appropriations that happen to mention health'
  },
  environment: {
    includes: 'clean energy, renewable energy, emissions standards, conservation, water quality, wildlife protection, pollution control, climate policy, land use for environmental purposes, recycling, stormwater, forest preservation',
    excludes: 'agricultural policy that is primarily about farm economics, transportation infrastructure (unless specifically about emissions or EV), mining/drilling that is primarily an economic bill'
  },
  education: {
    includes: 'K-12 school funding, teacher pay and certification, curriculum standards, higher education tuition and aid, school construction, special education, early childhood education, school choice, charter schools, literacy programs',
    excludes: 'workforce training programs (even if in schools), student loan policy that is primarily financial services, general appropriations that happen to fund schools'
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, pdfBase64, knownTopics } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
  }
  if (!text && !pdfBase64) {
    return res.status(400).json({ error: 'Provide either text or pdfBase64.' });
  }

  const topicList = Object.entries(knownTopics || {}).map(([code, t]) => {
    const subs = Object.entries(t.subtopics || {}).map(([sc, sl]) => `  • ${sc}: ${sl}`).join('\n');
    const guidance = TOPIC_GUIDANCE[code];
    return [
      `TOPIC: ${code} — "${t.label}"`,
      guidance ? `  Includes: ${guidance.includes}` : '',
      guidance ? `  Does NOT include: ${guidance.excludes}` : '',
      subs ? `  Subtopics:\n${subs}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const systemPrompt = `You extract structured data about a state legislative bill for a professional lobbying firm's database. Accurate classification is critical — it directly affects which legislators get recommended to clients.

${topicList ? `THE AVAILABLE TOPICS:\n\n${topicList}\n\n` : ''}CRITICAL RULES:
1. Only match a topic if the bill CLEARLY belongs there based on its actual policy content.
2. A bill affecting a particular population (veterans, seniors, teachers) does NOT automatically belong in any topic — what matters is what the bill actually DOES.
3. If confident about a topic, say so. If uncertain, return null — the user will classify manually.
4. Do NOT invent a sponsor name if none is mentioned in the text.

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
        max_tokens: 600,
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
