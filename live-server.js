import "dotenv/config";
import crypto from "crypto";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.LIVE_TRANSLATOR_PORT || 3000);
const REALTIME_TRANSLATION_MODEL =
  process.env.OPENAI_REALTIME_TRANSLATION_MODEL || "gpt-realtime-translate";
const SUPPORTED_OUTPUT_LANGUAGES = new Set([
  "ar",
  "de",
  "en",
  "es",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "pt",
  "ru",
  "tr",
  "zh",
]);

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error("Missing required environment variable: OPENAI_API_KEY");
  process.exit(1);
}

const app = express();

app.use(express.json({ limit: "64kb" }));
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, mode: "live-translator" });
});

app.post("/api/realtime-translation/session", async (req, res) => {
  const targetLanguage = String(req.body?.targetLanguage || "en").toLowerCase();

  if (!SUPPORTED_OUTPUT_LANGUAGES.has(targetLanguage)) {
    res.status(400).json({
      error: "Unsupported target language",
      supported: [...SUPPORTED_OUTPUT_LANGUAGES],
    });
    return;
  }

  const safetyIdentifier = crypto
    .createHash("sha256")
    .update(req.ip || "local-user")
    .digest("hex");

  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/translations/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": safetyIdentifier,
        },
        body: JSON.stringify({
          session: {
            model: REALTIME_TRANSLATION_MODEL,
            audio: {
              output: {
                language: targetLanguage,
              },
            },
          },
        }),
      }
    );

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error("Realtime translation session error:", error);
    res.status(500).json({ error: "Failed to create realtime translation session" });
  }
});

app.listen(PORT, () => {
  console.log(`Live translator is running at http://localhost:${PORT}`);
});
