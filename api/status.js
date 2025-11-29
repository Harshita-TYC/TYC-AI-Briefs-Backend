// api/status.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const ALLOWED_ORIGIN = process.env.SITE_ORIGIN || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const jobId = req.query.jobId;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  const { data, error } = await supabase.from('jobs').select('id, status, brief, error, updated_at').eq('id', jobId).limit(1).single();
  if (error) {
    console.error('status fetch error', error);
    return res.status(500).json({ error: 'status lookup failed' });
  }

  return res.status(200).json({
    id: data.id,
    status: data.status,
    brief: data.brief || null,
    error: data.error || null,
    updated_at: data.updated_at || null
  });
}api/status.js
