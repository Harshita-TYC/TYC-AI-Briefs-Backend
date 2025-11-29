// api/upload.js
import formidable from "formidable";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Supabase env missing (SUPABASE_URL or SUPABASE_SERVICE_KEY).");
}

// init supabase client (service role)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  // CORS: change allowed origin to your production domain
  res.setHeader("Access-Control-Allow-Origin", "https://traceyourcase.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // parse with formidable (v2+)
    const form = formidable({ multiples: false, keepExtensions: true });
    const parsed = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    const files = parsed.files || {};
    const fileKeys = Object.keys(files);
    if (fileKeys.length === 0) {
      return res.status(400).json({ ok: false, error: "no file uploaded" });
    }

    const fileObj = files[fileKeys[0]]; // take first file
    const localPath = fileObj.filepath || fileObj.filePath || fileObj.path;
    const originalName = fileObj.originalFilename || fileObj.name || "uploaded_file";

    if (!localPath || !fs.existsSync(localPath)) {
      return res.status(500).json({ ok: false, error: "uploaded file missing on server" });
    }

    // create unique storage path
    const timestamp = Date.now();
    const ext = path.extname(originalName) || "";
    const storagePath = `judgments/${timestamp}_${Math.random().toString(36).slice(2,8)}${ext}`;

    // upload to Supabase Storage (bucket: judgments)
    const fileStream = fs.createReadStream(localPath);
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("judgments")
      .upload(storagePath, fileStream, { cacheControl: "3600", upsert: false });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return res.status(500).json({ ok: false, error: "storage upload failed", details: uploadError.message || uploadError });
    }

    // get public URL (or a signed url — for private bucket use createSignedUrl)
    const { publicURL } = supabase.storage.from("judgments").getPublicUrl(uploadData.path);

    // Read the file to send to summarization if you want to pass text
    // For now, we'll ask the AI to summarize based on the file URL (or you may parse pdf -> text w/ pdf-parse)
    // Example: create a prompt that instructs the model to produce a student-ready brief.

    const prompt = `
You are a concise law-school assistant. A judgment is available at this URL: ${publicURL}
Create a student-ready brief with the following headings: Facts, Issues, Holding, Ratio/Reasoning, Disposition, Key Points. Keep each section short and clear (1-4 lines each). Use a neutral, academic tone.
`;

    // call OpenAI Chat completion (replace model as needed)
    if (!OPENAI_API_KEY) {
      console.warn("OPENAI_API_KEY not set, returning stub brief");
    }

    let briefText = "This is a stub brief returned immediately for testing. Replace with real logic later.";

    if (OPENAI_API_KEY) {
      const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini", // you can change model
          messages: [{ role: "system", content: "You are a law-school assistant." }, { role: "user", content: prompt }],
          max_tokens: 600,
          temperature: 0.2,
        }),
      });

      if (openaiResp.ok) {
        const j = await openaiResp.json();
        briefText = j?.choices?.[0]?.message?.content?.trim() || briefText;
      } else {
        console.error("OpenAI error status:", openaiResp.status);
        // keep stub briefText but include a note
        briefText = briefText + `\n\n[OpenAI call failed with status ${openaiResp.status}]`;
      }
    }

    // save brief record in Supabase table 'briefs' (create table with fields: id, storage_path, public_url, brief_text, created_at)
    const { data: insertData, error: insertError } = await supabase.from("briefs").insert([
      {
        storage_path: uploadData.path,
        public_url: publicURL,
        original_file_name: originalName,
        brief_text: briefText,
      },
    ]).select().single();

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      // Still return success upload but note insert failed
      return res.status(200).json({ ok: true, uploaded: uploadData, brief: briefText, saved: false, error: insertError.message || insertError });
    }

    // respond with brief
    return res.status(200).json({ ok: true, briefId: insertData.id, brief: briefText, file: { path: uploadData.path, url: publicURL } });
  } catch (err) {
    console.error("upload handler error:", err && (err.stack || err.message || err));
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}
