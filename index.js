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
  pl: "Polish",
  uk: "Ukrainian",
  nl: "Dutch",
  el: "Greek",
  sv: "Swedish",
  fi: "Finnish",
};

const languageKeyboard = Object.entries(languages).reduce((rows, [code, name], i) => {
  if (i % 2 === 0) rows.push([]);
  rows[rows.length - 1].push({
    text: name,
    callback_data: `lang_${code}`,
  });
  return rows;
}, []);

const mainMenu = {
  reply_markup: {
    keyboard: [
      ["🌍 Выбрать язык", "📌 Текущий язык"],
      ["ℹ️ Помощь", "🧹 Очистить язык"],
    ],
    resize_keyboard: true,
  },
};

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: {
    interval: 1000,
    autoStart: true,
    params: {
      timeout: 10,
    },
  },
});

async function shutdown(signal) {
  console.log(`Received ${signal}. Stopping polling...`);
  try {
    await bot.stopPolling();
  } catch (error) {
    console.error("Error stopping polling:", error);
  }
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

bot.on("polling_error", (error) => {
  console.error("Polling error:", error.message);
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

console.log("Translator Bot with Menu started...");

async function translateText(text, targetLanguage) {
  const result = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a professional translator. Automatically detect the source language of the user's text and translate it into ${targetLanguage}. Return only the translated text. Do not explain anything.`,
      },
      {
        role: "user",
        content: text,
      },
    ],
  });

  return result.choices[0].message.content;
}

async function downloadTelegramFile(fileId, outputPath) {
  const fileLink = await bot.getFileLink(fileId);

  const response = await axios({
    url: fileLink,
    method: "GET",
    responseType: "stream",
    timeout: 30000,
  });

  const writer = fs.createWriteStream(outputPath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

function cleanupFiles(files) {
  for (const file of files) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

async function showMainMenu(chatId) {
  const currentLanguage = userLanguages[chatId] || "English";

  await bot.sendMessage(
    chatId,
    `🤖 AI Translator Bot\n\nТекущий язык перевода: ${currentLanguage}\n\nОтправьте текст, голосовое или картинку с текстом.`,
    mainMenu
  );
}

async function showLanguageMenu(chatId) {
  await bot.sendMessage(chatId, "🌍 Выберите язык перевода:", {
    reply_markup: {
      inline_keyboard: languageKeyboard,
    },
  });
}

async function showHelp(chatId) {
  await bot.sendMessage(
    chatId,
    `ℹ️ Как пользоваться ботом:

1. Нажмите «🌍 Выбрать язык»
2. Выберите язык перевода
3. Отправьте:
   📝 текст
   🎤 голосовое
   🖼 картинку с текстом

Команды:
/start — главное меню
/language — выбрать язык
/status — текущий язык
/help — помощь

По умолчанию язык: English`,
    mainMenu
  );
}

bot.setMyCommands([
  { command: "start", description: "Главное меню" },
  { command: "language", description: "Выбрать язык перевода" },
  { command: "status", description: "Показать текущий язык" },
  { command: "help", description: "Помощь" },
]);

bot.onText(/\/start/, async (msg) => {
  await showMainMenu(msg.chat.id);
});

bot.onText(/\/language/, async (msg) => {
  await showLanguageMenu(msg.chat.id);
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const currentLanguage = userLanguages[chatId] || "English";

  await bot.sendMessage(chatId, `📌 Текущий язык перевода: ${currentLanguage}`, mainMenu);
});

bot.onText(/\/help/, async (msg) => {
  await showHelp(msg.chat.id);
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const langCode = query.data.replace("lang_", "");

  if (!languages[langCode]) {
    await bot.answerCallbackQuery(query.id, {
      text: "Неизвестный язык",
    });
    return;
  }

  userLanguages[chatId] = languages[langCode];
  saveLanguages(userLanguages);

  await bot.answerCallbackQuery(query.id);
  await bot.sendMessage(
    chatId,
    `✅ Язык сохранён: ${languages[langCode]}\nТеперь можно отправлять текст, голос или картинку.`,
    mainMenu
  );
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const targetLanguage = userLanguages[chatId] || "English";

  if (!msg.text) return;

  if (msg.text === "🌍 Выбрать язык") {
    await showLanguageMenu(chatId);
    return;
  }

  if (msg.text === "📌 Текущий язык") {
    await bot.sendMessage(chatId, `📌 Текущий язык перевода: ${targetLanguage}`, mainMenu);
    return;
  }

  if (msg.text === "ℹ️ Помощь") {
    await showHelp(chatId);
    return;
  }

  if (msg.text === "🧹 Очистить язык") {
    delete userLanguages[chatId];
    saveLanguages(userLanguages);
    await bot.sendMessage(chatId, "🧹 Язык сброшен. Теперь по умолчанию English.", mainMenu);
    return;
  }

  if (msg.text.startsWith("/")) return;

  try {
    await bot.sendMessage(chatId, `📝 Перевожу на ${targetLanguage}...`);
    const translatedText = await translateText(msg.text, targetLanguage);
    await bot.sendMessage(chatId, translatedText, mainMenu);
  } catch (error) {
    console.error("Text translation error:", error);
    await bot.sendMessage(chatId, "❌ Ошибка перевода текста.", mainMenu);
  }
});

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const targetLanguage = userLanguages[chatId] || "English";

  const timestamp = Date.now();
  const imagePath = path.resolve(`image_${timestamp}.jpg`);

  try {
    await bot.sendMessage(
      chatId,
      `🖼 Распознаю текст на картинке и перевожу на ${targetLanguage}...`
    );

    const photo = msg.photo[msg.photo.length - 1];
    await downloadTelegramFile(photo.file_id, imagePath);

    const imageBase64 = fs.readFileSync(imagePath, "base64");

    const result = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Extract all readable text from the image using OCR, then translate it into ${targetLanguage}. Return only the translated text.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Read the image text and translate it.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
    });

    const translatedText = result.choices[0].message.content;

    await bot.sendMessage(chatId, `🖼 Перевод с картинки:\n\n${translatedText}`, mainMenu);
  } catch (error) {
    console.error("Image OCR error:", error);
    await bot.sendMessage(chatId, "❌ Ошибка распознавания картинки.", mainMenu);
  } finally {
    cleanupFiles([imagePath]);
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

    await downloadTelegramFile(msg.voice.file_id, inputPath);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(inputPath),
      model: "gpt-4o-mini-transcribe",
    });

    const translatedText = await translateText(transcription.text, targetLanguage);

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
  } catch (error) {
    console.error("Voice translation error:", error);
    await bot.sendMessage(chatId, "❌ Ошибка обработки голосового.", mainMenu);
  } finally {
    cleanupFiles([inputPath, mp3Path, oggPath]);
  }
});