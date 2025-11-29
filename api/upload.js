// api/upload.js — TEMP debug endpoint (safe: doesn't print secrets)
export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  // Non-secret visibility check (only true/false, never outputs values)
  const vars = {
    SUPABASE_URL_present: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY_present: !!process.env.SUPABASE_SERVICE_KEY,
    OPENAI_API_KEY_present: !!process.env.OPENAI_API_KEY,
    NODE_VERSION: process.version
  };

  // Log on the server (safe) so Vercel logs will show it
  console.log('ENV presence check:', vars);

  // Return the presence report
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    ok: true,
    note: 'This is a debug response. It only reports presence (true/false) of env vars — not values.',
    vars
  });
}
