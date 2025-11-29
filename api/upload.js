// api/upload.js
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import { randomUUID } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ALLOWED_ORIGIN = process.env.SITE_ORIGIN || '*';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  // CORS + preflight
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const form = new formidable.IncomingForm();
  form.maxFileSize = 50 * 1024 * 1024; // 50 MB

  form.parse(req, async (err, fields, files) => {
    try {
      if (err) {
        console.error('Form parse error', err);
        return res.status(400).json({ error: 'Invalid upload' });
      }
      const file = files.file;
      if (!file) return res.status(400).json({ error: 'No file uploaded' });

      const jobId = 'job-' + randomUUID();
      const filename = file.originalFilename || file.newFilename || `upload-${Date.now()}`;
      const key = `${jobId}/${filename}`;

      const buffer = fs.readFileSync(file.filepath);

      const { error: upErr } = await supabase.storage
        .from('uploads')
        .upload(key, buffer, { contentType: file.mimetype, upsert: false });

      if (upErr) {
        console.error('Supabase upload error', upErr);
        return res.status(500).json({ error: 'Storage upload failed' });
      }

      const { error: insErr } = await supabase.from('jobs').insert([
        { id: jobId, filename, path: key, status: 'pending', created_at: new Date().toISOString() }
      ]);

      if (insErr) {
        console.error('Insert job error', insErr);
        return res.status(500).json({ error: 'Job create failed' });
      }

      return res.status(200).json({ jobId });
    } catch (e) {
      console.error('Upload handler error', e);
      return res.status(500).json({ error: 'Server error' });
    }
  });
}
