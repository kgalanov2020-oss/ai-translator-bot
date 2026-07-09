# AI Translator

AI-powered translation project with two modes:

- Telegram bot for text, voice messages, and images with readable text
- Browser live translator MVP for realtime speech translation with ordinary Bluetooth headphones

## Features

### Telegram bot

- Text translation with automatic source-language detection
- Voice message transcription and translation
- Image OCR and translation
- Text or voice replies
- 99 translation languages with paginated Telegram language selection
- Per-chat language and reply-mode settings
- Local JSON storage for user settings

### Live translator MVP

- Browser microphone input
- Realtime translated audio output
- Source and translated subtitles
- Works with normal Bluetooth headphones paired to the phone or laptop
- Keeps the standard OpenAI API key on the local server, not in the browser

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill in the values:

```env
OPENAI_API_KEY=your_openai_api_key_here
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
```

3. Start the Telegram bot:

```bash
npm start
```

4. Or start the live translator web MVP:

```bash
npm run live
```

Then open:

```text
http://localhost:3000
```

## Commands

- `/start` - main menu
- `/language` - choose translation language
- `/mode` - choose text or voice output
- `/status` - show current settings
- `/help` - help

## Optional Environment Variables

```env
DEFAULT_LANGUAGE=Russian
DEFAULT_OUTPUT_MODE=text
OPENAI_TRANSLATION_MODEL=gpt-4o-mini
OPENAI_OCR_MODEL=gpt-4o-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=alloy
LIVE_TRANSLATOR_PORT=3000
OPENAI_REALTIME_TRANSLATION_MODEL=gpt-realtime-translate
```

## Checks

```bash
npm run check
npm run audit
```

## Deploy To Render

This project uses two Render services:

- `ai-translator-bot` - Background Worker for the Telegram bot
- `ai-translator-live` - Web Service for the HTTPS live translator

1. Commit and push the project to GitHub:

```bash
git add .
git commit -m "Prepare Render deployment"
git push origin main
```

2. Open the Render Blueprint:

```text
https://dashboard.render.com/blueprint/new?repo=https://github.com/kgalanov2020-oss/ai-translator-bot
```

3. In Render, fill the secret environment variables:

```env
OPENAI_API_KEY=your_openai_api_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```

`TELEGRAM_BOT_TOKEN` is only needed for `ai-translator-bot`. `OPENAI_API_KEY` is needed for both services.

4. Apply the Blueprint and wait for both services to deploy.

After Render is live, stop any local `npm start` process. Only one Telegram polling process can use the same bot token. The live translator will be available at the Render HTTPS URL for `ai-translator-live`.

## Troubleshooting

If Telegram logs show this error:

```text
409 Conflict: terminated by other getUpdates request
```

the same Telegram bot token is already running somewhere else. Stop the old process or revoke the token in BotFather and put the new token into `.env`.

You can keep the same Telegram bot and username. In BotFather, open `/mybots`, choose the bot, open API Token, and revoke/regenerate the token.

## Product Direction

See [docs/device-translator-roadmap.md](docs/device-translator-roadmap.md) for the product path from this repo to a Bluetooth headphone translator.
