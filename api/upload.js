// api/upload.js (STUB) — fast local response for testing
export default async function handler(req, res) {
  // Allow your site (change if needed)
  res.setHeader('Access-Control-Allow-Origin', 'https://traceyourcase.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Quick check: accept only POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Very small artificial delay to simulate processing (optional)
  await new Promise(r => setTimeout(r, 200));

  // Return a stub brief
  const stub = {
    briefId: 'stub-' + Date.now(),
    brief: 'This is a stub brief returned immediately for testing. Replace with real logic later.'
  };

  return res.status(200).json(stub);
}
