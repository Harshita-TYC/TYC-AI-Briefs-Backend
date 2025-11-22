// api/chat.js
// Accepts JSON { brief, briefId, userMessage }
// Uses the brief (or stored briefId) as context and calls OpenAI to answer the user question.
// Returns { answer }

import fetch from "node-fetch";

// In-memory BRIEF_STORE is placed in upload.js for demo; if using separate files, you should use a shared DB.
// For the demo, we'll allow the client to pass the brief directly in the request.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body || "{}");
    const { userMessage, briefId, brief } = parsed;
    if (!userMessage) return res.status(400).json({ error: "Missing userMessage" });

    // Compose the system + user prompt so the assistant MUST use only the provided brief.
    const system = `You are "TYC Assistant" that answers ONLY using the provided case brief. 
If the answer cannot be confidently determined from the brief, reply "I don't know based on the provided brief; check the judgment." 
Always cite the brief section used (FACTS/ISSUES/RATIO/REASONING/SIGNIFICANCE) when possible.`;

    const userPrompt = `Brief:\n${brief || "(brief not provided)"}\n\nUser question: ${userMessage}\n\nAnswer concisely and cite the brief section you used.`;

    // Call OpenAI Chat Completion
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.0,
        max_tokens: 500,
      }),
    });

    if (!r.ok) {
      const txt = await r.text();
      console.error("OpenAI chat failed:", r.status, txt);
      return res.status(500).json({ error: "OpenAI chat failed" });
    }
    const j = await r.json();
    const answer = j.choices?.[0]?.message?.content || "";

    return res.json({ answer });
  } catch (err) {
    console.error("chat error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
