// api/process-job.js
import { createClient } from '@supabase/supabase-js';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const ALLOWED_ORIGIN = process.env.SITE_ORIGIN || '*';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  // allow GET for manual trigger
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // pick one pending job
    const { data: jobs, error: jobErr } = await supabase
      .from('jobs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (jobErr) { console.error('job fetch error', jobErr); return res.status(500).json({ error: 'job fetch failed' }); }
    if (!jobs || jobs.length === 0) return res.status(200).json({ message: 'no pending jobs' });

    const job = jobs[0];
    const jobId = job.id;
    const path = job.path;

    await supabase.from('jobs').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', jobId);

    const { data: downloadData, error: dlErr } = await supabase.storage.from('uploads').download(path);
    if (dlErr) {
      console.error('download error', dlErr);
      await supabase.from('jobs').update({ status: 'failed', error: JSON.stringify(dlErr), updated_at: new Date().toISOString() }).eq('id', jobId);
      return res.status(500).json({ error: 'download failed' });
    }
    const buf = Buffer.from(await downloadData.arrayBuffer());

    // extract text by extension
    const ext = job.filename.split('.').pop().toLowerCase();
    let extractedText = '';
    if (ext === 'pdf') {
      const data = await pdfParse(buf);
      extractedText = data.text;
    } else if (ext === 'docx' || ext === 'doc') {
      const result = await mammoth.extractRawText({ buffer: buf });
      extractedText = result.value;
    } else {
      try { const data = await pdfParse(buf); extractedText = data.text; } catch (e) { extractedText = ''; }
    }

    if (!extractedText || extractedText.trim().length === 0) {
      await supabase.from('jobs').update({ status: 'failed', error: 'no text extracted', updated_at: new Date().toISOString() }).eq('id', jobId);
      return res.status(200).json({ error: 'no text extracted' });
    }

    // Create a succinct prompt for OpenAI to produce a law-school style brief
    const prompt = `You are a legal assistant that writes concise law-school-ready case briefs. Structure the brief with headings: Facts, Issues, Holding, Ratio/Reasoning, Short Analysis. Be concise and use plain English. \n\nText:\n${extractedText.slice(0, 12000)}`;

    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: 'You produce concise legal briefs.' }, { role: 'user', content: prompt }],
        max_tokens: 900,
        temperature: 0.2
      })
    });

    if (!openaiResp.ok) {
      const txt = await openaiResp.text().catch(() => '');
      console.error('OpenAI error', openaiResp.status, txt);
      await supabase.from('jobs').update({ status: 'failed', error: txt, updated_at: new Date().toISOString() }).eq('id', jobId);
      return res.status(500).json({ error: 'OpenAI call failed' });
    }

    const json = await openaiResp.json();
    const brief = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || JSON.stringify(json);

    await supabase.from('jobs').update({ status: 'done', brief, updated_at: new Date().toISOString() }).eq('id', jobId);

    return res.status(200).json({ jobId, status: 'done' });
  } catch (e) {
    console.error('process-job error', e);
    return res.status(500).json({ error: 'worker error' });
  }
}
