// api/process.js
// Node runtime handler for Vercel (use Node-style handler)
// Expects JSON POST { storagePath, publicUrl, prompt? }
// Uses SUPABASE_SERVICE_KEY and OPENAI_API_KEY from Vercel env vars.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BUCKET_NAME = "Judgement Uploads"; // exact bucket name

// helper: set CORS headers on every response
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://traceyourcase.com"); // change to '*' only for quick testing
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// initialize supabase client with service key (server-side)
const supabase = createClient(SUPABASE_URL || "", SUPABASE_SERVICE_KEY || "");

export default async function handler(req, res) {
  // Preflight
  if (req.method === "OPTIONS") {
    setCors(res);
    return res.status(204).end();
  }
  setCors(res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Read JSON body robustly
    let body = req.body;
    if (!body || Object.keys(body).length === 0) {
      // try parse raw data (some runtimes don't auto-parse)
      body = await new Promise((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            resolve({});
          }
        });
        req.on("error", () => resolve({}));
      });
    }

    const { storagePath, publicUrl, prompt } = body || {};

    if (!storagePath && !publicUrl && !prompt) {
      return res.status(400).json({ error: "storagePath or publicUrl or prompt required" });
    }

    // Determine file URL (prefer publicUrl)
    let fileUrl = publicUrl || null;
    if (!fileUrl && storagePath) {
      const { data: urlData, error: urlErr } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
      if (urlErr) {
        console.warn("getPublicUrl warning:", urlErr);
      } else {
        fileUrl = urlData?.publicUrl || null;
      }
    }

    // Build prompt: if user supplied explicit prompt, use it; else reference the file URL
    const userPrompt = prompt && prompt.trim()
      ? prompt
      : `You are a concise law-school assistant. Summarize the judgment available at: ${fileUrl}
Produce a student-ready brief with headings: Facts; Issues; Holding; Ratio/Reasoning; Disposition; Key Points (3 bullets). Keep each heading concise.`;

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured in server" });
    }

    // Call OpenAI Chat Completion
    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // change if needed
        messages: [
          { role: "system", content: "You are a concise law-school assistant." },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 800,
        temperature: 0.1,
      }),
    });

    if (!openaiResp.ok) {
      const txt = await openaiResp.text();
      console.error("OpenAI API error:", openaiResp.status, txt);
      return res.status(502).json({ error: "OpenAI API error", details: txt });
    }

    const openaiJson = await openaiResp.json();
    const briefText = openaiJson?.choices?.[0]?.message?.content?.trim() || "No brief generated";

    // Save brief to Supabase (if table exists)
    try {
      const { data: insertData, error: insertErr } = await supabase
        .from("briefs")
        .insert([{ storage_path: storagePath || null, public_url: fileUrl || null, brief_text: briefText }])
        .select()
        .single();

      if (insertErr) {
        console.warn("Supabase insert briefs warning:", insertErr);
      }
    } catch (e) {
      console.warn("Supabase insert exception:", e?.message || e);
    }

    return res.status(200).json({ ok: true, brief: briefText });
  } catch (err) {
    console.error("process handler error:", err && (err.stack || err.message || err));
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
