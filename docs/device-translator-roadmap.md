# Device Translator Roadmap

This project can grow from a Telegram bot into a sellable translator product, but the live device path is separate from Telegram. Telegram voice messages are asynchronous. A real interpreter product needs continuous audio streaming, low-latency translation, and playback through headphones.

## Current Project

The repo now has two modes:

- `npm start` runs the Telegram bot.
- `npm run live` runs a browser-based live translator MVP.

The live MVP uses the OpenAI Realtime translation flow:

```text
microphone -> browser WebRTC -> local server -> OpenAI realtime translation -> translated audio -> headphones
```

The browser never receives the standard OpenAI API key. The local server creates a short-lived client secret for each translation session.

## MVP Path

1. Test with a phone or laptop and normal Bluetooth headphones.
2. Measure perceived delay, translation quality, battery use, and network stability.
3. Add user accounts, usage limits, logs, and billing only after the translation experience is acceptable.
4. Package the browser MVP as a mobile app.
5. Move to custom hardware only after product-market validation.

## Hardware Path

For a physical product, use one of these approaches:

- Mobile-first: phone app handles translation, headphones are standard Bluetooth audio devices.
- Companion device: small wearable or pocket device captures audio and sends it to the API.
- OEM earbuds: custom earbuds plus firmware plus mobile app.

The mobile-first path is fastest and lowest risk. OEM earbuds are much slower because they add firmware, battery, acoustic design, manufacturing, certification, returns, and warranty work.

## Compliance Notes

This is product planning, not legal advice.

For the United States, a wireless product generally needs FCC equipment authorization before it is marketed or imported.

For the EU, a Bluetooth/radio product generally needs CE marking and Radio Equipment Directive compliance.

Avoid marketing the product as a hearing aid or as treatment for hearing loss unless you intentionally enter medical-device compliance. Position it as a translation accessory, interpreter app, or AI translator.

## Technical Backlog

- Add account-based auth for live sessions.
- Add one-session-per-user limits.
- Add usage metering and cost controls.
- Add reconnect and unavailable states.
- Add language-pair quality tests with bilingual review.
- Add mobile app prototype.
- Add device pairing and audio-route UX.
- Add privacy policy and consent flow for microphone use.
- Add production deployment with HTTPS. Browser microphone access requires a secure context except for localhost.
