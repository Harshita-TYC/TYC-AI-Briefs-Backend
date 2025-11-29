// api/upload.js
// ESM module (package.json type: "module")
import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";
import fs from "fs";

const allowedOrigin = "https://traceyourcase.com"; // change if needed

// Initialize supabase client once (read envs)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing Supabase envs: SUPABASE_URL or SUPABASE_SERVICE_KEY");
}

// Create supabase client
const supabase = createClient(SUPABASE_URL || "", SUPABASE_SERVICE_KEY || "", {
  auth: { autoRefreshToken: false },
});

function sendCORSHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  // Handle preflight
  sendCORSHeaders(res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // formidable usage: create parser instance (ESM-friendly)
    // This returns {files, fields} on parse
    const form = formidable({ keepExtensions: true, maxFileSize: 30 * 1024 * 1024 }); // 30MB safe ceiling
    const parsed = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    const { files } = parsed;
    if (!files || !files.file) {
      return res.status(400).json({ error: "No file uploaded (field name must be 'file')" });
    }

    // In formidable v2, file might be object or array
    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;
    const filepath = uploadedFile.filepath || uploadedFile.path || uploadedFile.path; // different shapes
    const originalName = uploadedFile.originalFilename || uploadedFile.name || "upload.pdf";

    // Read file buffer
    const fileBuffer = await fs.promises.readFile(filepath);

    // Upload to Supabase Storage (example: bucket 'judgements' — create bucket in Supabase console)
    const bucket = "judgement uploads";
    const key = `uploads/${Date.now()}-${originalName}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(key, fileBuffer, {
        contentType: uploadedFile.mimetype || "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return res.status(500).json({ error: "Storage upload failed", details: uploadError.message });
    }

    // Generate public URL or signed URL (publicURL requires bucket to be public)
    const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(key);

    // For MVP return a stub brief (replace with AI processing flow)
    const brief = "This is a stub brief returned immediately for testing. Replace with real logic later.";

    return res.status(200).json({
      ok: true,
      briefId: key,
      brief,
      storage: {
        key,
        publicUrl: publicUrlData?.publicUrl || null,
      },
    });
  } catch (err) {
    console.error("upload handler error:", err);
    return res.status(500).json({ error: "Server error", message: String(err?.message || err) });
  }
}
