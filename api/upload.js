// api/upload.js
import formidable from "formidable";

export default async function handler(req, res) {
  // Basic CORS (adjust allowed origin for production)
  res.setHeader("Access-Control-Allow-Origin", "https://traceyourcase.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    console.log("upload handler: start");

    // Use formidable v2+ recommended API (factory call)
    const form = formidable({
      multiples: false,
      keepExtensions: true,
      // maxFileSize: 20 * 1024 * 1024, // optional: 20 MB
    });

    const parsed = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) {
          return reject(err);
        }
        resolve({ fields, files });
      });
    });

    console.log("upload handler - parsed keys:", Object.keys(parsed.files || {}), Object.keys(parsed.fields || {}));

    // For now return the file names/sizes (replace with real processing)
    const files = parsed.files || {};
    const fileInfo = Object.entries(files).map(([k, v]) => {
      return {
        fieldName: k,
        filename: v.originalFilename ?? v.newFilename ?? v.fileName ?? "unknown",
        mime: v.mimetype ?? v.mimetype ?? v.type ?? "unknown",
        size: v.size ?? "unknown",
        path: v.filepath ?? v.filePath ?? v.path ?? null,
      };
    });

    // TEMP: a stub brief - replace with your AI brief generation
    const brief = "This is a stub brief returned immediately for testing. Replace with real logic later.";

    return res.status(200).json({ ok: true, files: fileInfo, brief });
  } catch (err) {
    console.error("upload handler error:", err && (err.stack || err.message || err));
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}
