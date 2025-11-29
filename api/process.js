// api/process.js
import { createClient } from "@supabase/supabase-js";

// Vercel serverless: this handler expects JSON body { storagePath, publicUrl }
// and uses SUPABASE_SERVICE_KEY + OPENAI_API_KEY from Vercel env for secure operations.

export const config = {
  runtime: "edge" // optional; if you get issues, remove this line to use Node runtime
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BUCKET_NAME = "Judgement Uploads"; // exact bucket name

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// helper to set CORS for browser
function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://traceyourcase.com"); // change if needed
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  // Preflight
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    return res.status(204).end();
  }

  setCorsHeaders(res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body && Object.keys(req.body).length ? req.body : await (async () => {
      // For some serverless setups req.body is already parsed; for others ensure parsing:
      return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", chunk => data += chunk);
        req.on("end", () => {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) { resolve({}); }
        });
        req.on("error", reject);
      });
    })();

    const { storagePath, publicUrl } = body || {};

    if (!storagePath && !publicUrl) {
      return res.status(400).json({ error: "storagePath or publicUrl required" });
    }

    // Determine file URL. Prefer publicUrl if provided (frontend uploaded public).
    let fileUrl = publicUrl || null;

    // If no publicUrl, try to create/get public url from Supabase
    if (!fileUrl && storagePath) {
      const { data: urlData, error: urlErr } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
      if (urlErr) {
        console.warn("getPublicUrl error:", urlErr);
      } else {
        fileUrl = urlData?.publicUrl || null;
      }
    }

    // If still no fileUrl, attempt to download bytes (we won't send bytes to OpenAI; we will reference the URL)
    if (!fileUrl && storagePath) {
      const down = await supabase.storage.from(BUCKET_NAME).download(storagePath);
      if (down.error) {
        console.error("Supabase download error:", down.error);
        return res.status(500).json({ error: "Failed to download file from Supabase", details: down.error });
      }
      // If bucket is private, you can convert bytes to text or base64 and send to OpenAI files endpoint.
      // For MVP we prefer publicUrl. Inform user to make bucket public if needed.
      // Save temporary local buffer if needed (not doing here).
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key missing in server config" });
    }

    // Build the prompt referencing the file URL (clean and instructive)
    const prompt = `
You are a concise law-school assistant. A judgment is available at this URL: ${fileUrl}
Produce a student-ready brief with these headings: Facts, Issues, Holding, Ratio/Reasoning, Disposition, Key Points (3 bullets).
Keep each heading concise (1-4 lines). Use neutral, academic tone.
`;

    // Call OpenAI Chat Completions API
    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a concise law-school assistant." },
          { role: "user", content: prompt }
        ],
        max_tokens: 800,
        temperature: 0.1
      })
    });

    if (!openaiResp.ok) {
      const txt = await openaiResp.text();
      console.error("OpenAI error:", openaiResp.status, txt);
      return res.status(500).json({ error: "OpenAI API error", status: openaiResp.status, details: txt });
    }

    const openaiJson = await openaiResp.json();
    const briefText = openaiJson?.choices?.[0]?.message?.content?.trim() || "No brief generated";

    // Save brief into Supabase table 'briefs' (if exists)
    try {
      const { data: insertData, error: insertErr } = await supabase
        .from("briefs")
        .insert([{ storage_path: storagePath || null, public_url: fileUrl || null, brief_text: briefText }])
        .select()
        .single();

      if (insertErr) {
        console.warn("Supabase insert error (briefs):", insertErr);
      }
    } catch (e) {
      console.warn("Supabase insert exception:", e);
    }

    return res.status(200).json({ ok: true, brief: briefText });
  } catch (err) {
    console.error("process handler error:", err && (err.stack || err.message || err));
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
