// api/upload.js
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';

// Disable Next/Vercel body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

// --- ENVIRONMENT VARIABLES ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Your actual bucket name — FIXED
const BUCKET_NAME = "Judgement Uploads";

// Init supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// --- MAIN HANDLER ---
export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // --- Parse incoming file ---
    const form = new formidable.IncomingForm();

    const parsed = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    const file = parsed.files?.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileBuffer = fs.readFileSync(file.filepath);

    // Create a unique destination filename
    const destPath = `uploads/${Date.now()}_${file.originalFilename}`;

    // --- Upload to Supabase ---
    const { data, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(destPath, fileBuffer, {
        contentType: file.mimetype || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return res.status(500).json({
        error: "Upload to Supabase failed",
        details: uploadError.message,
      });
    }

    // --- Get public URL (if bucket is public) ---
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(destPath);

    const publicUrl = urlData?.publicUrl || null;

    // --- Final Response ---
    return res.status(200).json({
      ok: true,
      message: "File uploaded successfully",
      storageKey: destPath,
      publicUrl,
      brief: "This is a stub brief returned immediately for testing. Replace with real logic later."
    });

  } catch (err) {
    console.error("Upload handler error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Unknown server error",
    });
  }
}
