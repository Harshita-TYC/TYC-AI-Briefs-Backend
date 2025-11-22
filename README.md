# TYC AI Backend (MVP)

This repository contains the minimal backend for **Trace Your Case (TYC)**.  
It exposes two serverless endpoints for:

- **`POST /api/upload`**  
  Upload a judgment (PDF or DOCX) → returns a structured student-ready brief:  
  ```json
  { "briefId": "...", "brief": "FACTS... ISSUES... RATIO... etc." }
