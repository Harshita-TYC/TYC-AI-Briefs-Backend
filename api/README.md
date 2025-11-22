# TYC AI Backend (MVP)

This repository contains a tiny backend for Trace Your Case (TYC). It provides two serverless endpoints:

- `POST /api/upload` — accepts a judgment PDF/DOCX and returns a student-friendly brief `{ briefId, brief }`.
- `POST /api/chat` — accepts `{ brief, briefId, userMessage }` and returns `{ answer }`.

> This is an MVP. For production use replace the in-memory storage with a persistent DB (Supabase/Pinecone/S3), implement proper auth, rate-limiting, logging, and monitoring.

## Quick deploy (Vercel)

1. Create a new GitHub repo and add these files: `api/upload.js`, `api/chat.js`, `package.json`, `README.md`.
2. On https://vercel.com, create a new project and import the GitHub repo.
3. Set environment variable in Vercel Project → Settings → Environment Variables:
   - `OPENAI_API_KEY` = *your OpenAI API key*
4. Deploy.

The functions will be available at:
