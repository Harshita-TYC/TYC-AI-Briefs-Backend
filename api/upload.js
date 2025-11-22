// api/upload.js
// Vercel-style serverless function (Node). Accepts multipart/form-data file uploads
// or a JSON body with { file_url: "<remote-url-or-local-path>" } for testing.
// Extracts text from PDF / DOCX, calls OpenAI to produce a student-friendly brief,
// stores brief in a very small in-memory map (for demo) and returns { brief, briefId }.

import formidable from "formidable";
import fs from "fs";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";

export const config = { api: { bodyParser: false } };

// In-memory brief store for demo. Replace with DB in production.
const BRIEF_STORE = {};

async function extractTextFromPdfBuffer(buffer) {
  const data = await pdfParse(buffer);
  return data.text || "";
}

async function extractTextFromDocxBuffer(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

async function fetchBufferFromUrl(url) {
  // allow local path (developer pipeline may transform local path into a URL)
  // if it's a "file://" or absolute local path, try to read from disk (useful in testing)
  if (url.startsWith("/") && fs.existsSync(url)) {
    return fs.readFileSync(url);
  }
  if (url.startsWith("file://")) {
    const localPath = url.replace("file://", "");
    if (fs.existsSync(localPath)) return fs.readFileSync(localPath);
  }

  // else fetch over http(s)
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

async function callOpenAiSummarize(text) {
  // Build a prompt for the LLM. Keep it explicit about style/sections.
  const prompt = `You are an assistant that writes law-school-ready case briefs for Indian law students.
Summarise the judgment text below into a concise 300-450 word brief with the following headings:
FACTS, ISSUES, RATIO/HOLDING, REASONING (brief), SIGNIFICANCE (one-line).
Do not invent facts. If the text doesn't state something, do not assert it.
Use plain, student-friendly language.

Judgment text:
---
${text}
---`;

  // Use OpenAI Chat Completions (chat API)
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini", // change if needed
      messages: [
        { role: "system", content: "You are a helpful legal research assistant." },
        { role: "user", content: prompt },
      ],
      max_tokens: 900,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI summarize failed: ${res.status} ${res.statusText} - ${text}`);
  }
  const j = await res.json();
  const brief = j.choices?.[0]?.message?.content?.trim() ?? "";
  return brief;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // If JSON body with { file_url } (testing fallback)
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("application/json")) {
      // parse JSON body (Vercel's Node environment doesn't parse body here because bodyParser is false)
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || "{}");
      if (!parsed.file_url) return res.status(400).json({ error: "Missing file_url in JSON body" });

      const fileBuffer = await fetchBufferFromUrl(parsed.file_url);
      // try to detect format from URL extension
      const lower = parsed.file_url.toLowerCase();
      let text = "";
      if (lower.endsWith(".pdf")) text = await extractTextFromPdfBuffer(fileBuffer);
      else if (lower.endsWith(".doc") || lower.endsWith(".docx")) text = await extractTextFromDocxBuffer(fileBuffer);
      else {
        // fallback: try PDF -> docx
        try { text = await extractTextFromPdfBuffer(fileBuffer); } catch (e) { text = await extractTextFromDocxBuffer(fileBuffer); }
      }

      // shorten very long text (safety)
      const textForModel = text.length > 300000 ? text.slice(0, 300000) : text;
      const brief = await callOpenAiSummarize(textForModel);

      const briefId = uuidv4();
      BRIEF_STORE[briefId] = { brief, text: textForModel, createdAt: Date.now() };

      return res.json({ briefId, brief });
    }

    // else assume multipart/form-data with a file
    const form = new formidable.IncomingForm();
    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error("form parse error:", err);
        return res.status(500).json({ error: "File upload failed" });
      }
      const file = files.file || files.upload || Object.values(files)[0];
      if (!file) return res.status(400).json({ error: "No file uploaded (field name 'file')" });

      const buffer = fs.readFileSync(file.filepath || file.path || file.tempFilePath || file.path);
      const name = (file.originalFilename || file.name || file.filename || "").toLowerCase();

      let text = "";
      if (name.endsWith(".pdf") || (file.mimetype && file.mimetype.includes("pdf"))) {
        text = await extractTextFromPdfBuffer(buffer);
      } else if (name.endsWith(".docx") || name.endsWith(".doc") || (file.mimetype && file.mimetype.includes("word"))) {
        text = await extractTextFromDocxBuffer(buffer);
      } else {
        // attempt pdf first, then docx
        try { text = await extractTextFromPdfBuffer(buffer); }
        catch (err2) { text = await extractTextFromDocxBuffer(buffer); }
      }

      const textForModel = text.length > 300000 ? text.slice(0, 300000) : text;
      const brief = await callOpenAiSummarize(textForModel);

      const briefId = uuidv4();
      BRIEF_STORE[briefId] = { brief, text: textForModel, createdAt: Date.now() };

      return res.json({ briefId, brief });
    });
  } catch (err) {
    console.error("upload error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
