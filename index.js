import "dotenv/config";
import fs from "fs";
import path from "path";
import axios from "axios";
import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const languagesFile = "userLanguages.json";

function loadLanguages() {
  if (fs.existsSync(languagesFile)) {
    return JSON.parse(fs.readFileSync(languagesFile, "utf8"));
  }
  return {};
}

function saveLanguages(data) {
  fs.writeFileSync(languagesFile, JSON.stringify(data, null, 2));
}

const userLanguages = loadLanguages();

const languages = {
  en: "English",
  zh: "Chinese",
  hi: "Hindi",
  hu: "Hungarian",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  tr: "Turkish",
  ar: "Arabic",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  ms: "Malay",
  fa: "Persian",
  he: "Hebrew",
  pl: "Polish",
  cs: "Czech",
  sk: "Slovak",
  ro: "Romanian",
  bg: "Bulgarian",
  uk: "Ukrainian",
  nl: "Dutch",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  el: "Greek",
};

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

console.log("Voice Translator Bot started...");

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const savedLanguage = userLanguages[chatId];

  await bot.sendMessage(
    chatId,
    savedLanguage
      ? `Текущий язык: ${savedLanguage}\nВыберите новый язык или отправьте голосовое.`
      : "Выберите язык перевода:",
    {
      reply_markup: {
      inline_keyboard: [
        [
          { text: "🇺🇸 English", callback_data: "lang_en" },
          { text: "🇨🇳 Chinese", callback_data: "lang_zh" },
        ],
        [
          { text: "🇮🇳 Hindi", callback_data: "lang_hi" },
          { text: "🇭🇺 Hungarian", callback_data: "lang_hu" },
        ],
        [
          { text: "🇪🇸 Spanish", callback_data: "lang_es" },
          { text: "🇫🇷 French", callback_data: "lang_fr" },
        ],
        [
          { text: "🇩🇪 German", callback_data: "lang_de" },
          { text: "🇮🇹 Italian", callback_data: "lang_it" },
        ],
        [
          { text: "🇵🇹 Portuguese", callback_data: "lang_pt" },
          { text: "🇹🇷 Turkish", callback_data: "lang_tr" },
        ],
        [
          { text: "🇦🇪 Arabic", callback_data: "lang_ar" },
          { text: "🇷🇺 Russian", callback_data: "lang_ru" },
        ],
        [
          { text: "🇯🇵 Japanese", callback_data: "lang_ja" },
          { text: "🇰🇷 Korean", callback_data: "lang_ko" },
        ],
        [
          { text: "🇻🇳 Vietnamese", callback_data: "lang_vi" },
          { text: "🇹🇭 Thai", callback_data: "lang_th" },
        ],
        [
          { text: "🇮🇩 Indonesian", callback_data: "lang_id" },
          { text: "🇲🇾 Malay", callback_data: "lang_ms" },
        ],
        [
          { text: "🇵🇱 Polish", callback_data: "lang_pl" },
          { text: "🇺🇦 Ukrainian", callback_data: "lang_uk" },
        ],
        [
          { text: "🇳🇱 Dutch", callback_data: "lang_nl" },
          { text: "🇬🇷 Greek", callback_data: "lang_el" },
        ],
        [
          { text: "🇸🇪 Swedish", callback_data: "lang_sv" },
          { text: "🇫🇮 Finnish", callback_data: "lang_fi" },
        ],
      ]      },
    }
  );
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const langCode = query.data.replace("lang_", "");

  userLanguages[chatId] = languages[langCode];
  saveLanguages(userLanguages);

  await bot.answerCallbackQuery(query.id);
  await bot.sendMessage(
    chatId,
    `✅ Язык сохранён: ${languages[langCode]}\nТеперь можно просто отправлять голосовые.`
  );
});

bot.on("message", async (msg) => {
  if (msg.text && msg.text !== "/start") {
    const savedLanguage = userLanguages[msg.chat.id];

    await bot.sendMessage(
      msg.chat.id,
      savedLanguage
        ? `Текущий язык: ${savedLanguage}. Отправьте голосовое 🎤`
        : "Нажмите /start, выберите язык и отправьте голосовое 🎤"
    );
  }
});

bot.on("voice", async (msg) => {
  const chatId = msg.chat.id;
  const targetLanguage = userLanguages[chatId] || "English";

  const timestamp = Date.now();
  const inputPath = path.resolve(`voice_${timestamp}.ogg`);
  const mp3Path = path.resolve(`speech_${timestamp}.mp3`);
  const oggPath = path.resolve(`speech_${timestamp}.ogg`);

  try {
    await bot.sendMessage(chatId, `🎧 Перевожу на ${targetLanguage}...`);

    const fileLink = await bot.getFileLink(msg.voice.file_id);

    const response = await axios({
      url: fileLink,
      method: "GET",
      responseType: "stream",
    });

    const writer = fs.createWriteStream(inputPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(inputPath),
      model: "gpt-4o-mini-transcribe",
    });

    const userText = transcription.text;

    const translation = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Translate the user's text into ${targetLanguage}. Return only the translated text.`,
        },
        {
          role: "user",
          content: userText,
        },
      ],
    });

    const translatedText = translation.choices[0].message.content;

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: translatedText,
    });

    fs.writeFileSync(mp3Path, Buffer.from(await speech.arrayBuffer()));

    await new Promise((resolve, reject) => {
      ffmpeg(mp3Path)
        .audioCodec("libopus")
        .format("ogg")
        .save(oggPath)
        .on("end", resolve)
        .on("error", reject);
    });

    await bot.sendVoice(chatId, oggPath, {
      caption: `📝 ${translatedText}`,
    });

    [inputPath, mp3Path, oggPath].forEach((file) => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
  } catch (error) {
    console.error(error);
    await bot.sendMessage(chatId, "❌ Ошибка. Попробуйте ещё раз.");
  }
});
