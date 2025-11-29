// api/upload.js
// Minimal file upload handler that:
// 1) accepts a multipart/form-data file (field name 'file')
// 2) stores it into Supabase Storage (bucket 'uploads')
// 3) returns a stub brief (replace with real summarization / OpenAI calls later)
// Important: This file logs errors to Vercel logs for debugging but never prints secret values.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// --- helper: robust formidable importer/constructor (handles variations) ---
async function makeFormidable() {
  try {
    // Try common ESM default import
    const mod = await import('formidable');
    // mod.default might be a function (formidable) or object with IncomingForm
    if (typeof mod.default === 'function') {
      return { create: (...opts) => mod.default(...opts) };
    }
    if (mod.IncomingForm) {
      return { create: () => new mod.IncomingForm() };
    }
    if (mod.formidable) {
      // node-dom-exception variations
      return { create: () => mod.formidable() };
    }
    // fallback: use default if present
    return { create: (...opts) => (mod.default ? mod.default(...opts) : null) };
  } catch (err) {
    // Re-throw to be handled by caller
    throw new Error('Failed to import formidable: ' + err.message);
  }
}

// --- helper: parse form into {fields, files} using a Promise wrapper ---
function parseFormWith(formidableFactory, req) {
  return new Promise((resolve, reject) => {
    try {
      const form = formidableFactory.create
        ? formidableFactory.create()
        : formidableFactory(); // fallback
      // configure: keep file extensions, use os.tmpdir for uploads
      if (form && typeof form === 'object') {
        form.uploadDir = os.tmpdir();
        form.keepExtensions = true;
        // optional: increase file size limits here if you want
        // form.maxFileSize = 50 * 1024 * 1024; // 50MB
      }

      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    } catch (err) {
      reject(err);
    }
  });
}

// --- SUPABASE client factory (safe: uses environment vars only) ---
function getSupabaseClient() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase environment variables missing');
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
}

// --- small helper to read file buffer from formidable file object ---
async function readFileBuffer(fileObj) {
  // formidable v2 stores .filepath or .path depending on version
  const fp = fileObj?.filepath ?? fileObj?.path;
  if (!fp) throw new Error('Uploaded file path not found on server.');
  return fs.promises.readFile(fp);
}

// --- main handler ---
export default async function handler(req, res) {
  // handle preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Safe presence checks (no secret values)
  console.log('upload handler: NODE_VERSION=', process.version);
  console.log('upload handler: ENV presence:',
    { SUPABASE_URL_present: !!process.env.SUPABASE_URL, SUPABASE_SERVICE_KEY_present: !!process.env.SUPABASE_SERVICE_KEY }
  );

  // Step 1 - import/formidable set up
  let formidableFactory;
  try {
    formidableFactory = await makeFormidable();
  } catch (err) {
    console.error('Failed to import/init formidable:', err);
    return res.status(500).json({ error: 'Server error: upload parsing library not available' });
  }

  // Step 2 - parse incoming form
  let parsed;
  try {
    parsed = await parseFormWith(formidableFactory, req);
  } catch (err) {
    console.error('Form parse error:', err);
    return res.status(500).json({ error: 'Failed to parse uploaded file', details: err.message });
  }

  const { files = {}, fields = {} } = parsed;
  // Expect the file input to be named 'file' (adjust on frontend if different)
  const fileKey = files.file ? 'file' : Object.keys(files)[0];
  if (!fileKey) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileObj = files[fileKey];
  try {
    // Step 3 - read file buffer
    const buffer = await readFileBuffer(fileObj);
    // build destination path/filename
    const originalName = fileObj.originalFilename ?? fileObj.name ?? `upload-${Date.now()}`;
    const filename = `${Date.now()}-${originalName.replace(/\s+/g, '_')}`;

    // Step 4 - upload to Supabase Storage
    const supabase = getSupabaseClient();
    const bucket = 'uploads'; // IMPORTANT: ensure this bucket exists in your Supabase project
    try {
      const { data: uploadRes, error: upErr } = await supabase.storage.from(bucket).upload(filename, buffer, { cacheControl: '3600', upsert: false });
      if (upErr) {
        console.error('Supabase storage upload failed:', upErr);
        return res.status(500).json({ error: 'Failed to store file', details: upErr.message });
      }
      // generate a public URL (if your bucket policy allows) — otherwise return path
      const { data: publicUrlData, error: urlErr } = supabase.storage.from(bucket).getPublicUrl(filename);
      const storedUrl = urlErr ? null : publicUrlData?.publicUrl ?? null;

      // Step 5 - generate a stub brief (TODO: replace with OpenAI summarization)
      // NOTE: This is the place to call OpenAI using process.env.OPENAI_API_KEY and your prompt/template.
      const brief = {
        briefId: `stub-${Date.now()}`,
        sourceFile: filename,
        sourceUrl: storedUrl,
        summary: `This is a stub brief returned immediately for testing. Replace with real logic later.`,
      };

      console.log('Upload success:', { filename, storedUrl, briefId: brief.briefId });

      return res.status(200).json({ ok: true, brief });
    } catch (err) {
      console.error('Error while uploading to supabase or generating brief:', err);
      return res.status(500).json({ error: 'Server error during storage/brief generation', details: err?.message });
    }
  } catch (err) {
    console.error('Error processing uploaded file:', err);
    return res.status(500).json({ error: 'Server error processing file', details: err?.message });
  }
}
