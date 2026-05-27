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
const outputModesFile = "userOutputModes.json";

const DEFAULT_LANGUAGE = "Russian";
const DEFAULT_OUTPUT_MODE = "text";

function loadJson(file) {
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return {};
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const userLanguages = loadJson(languagesFile);
const userOutputModes = loadJson(outputModesFile);

const languages = {
  ru: "Russian",
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
      ["🔊 Режим ответа", "ℹ️ Помощь"],
      ["🧹 Очистить язык"],
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

console.log("Translator Bot with output mode started...");

function getTargetLanguage(chatId) {
  return userLanguages[chatId] || DEFAULT_LANGUAGE;
}

function getOutputMode(chatId) {
  return userOutputModes[chatId] || DEFAULT_OUTPUT_MODE;
}

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

async function sendTranslation(chatId, translatedText) {
  const mode = getOutputMode(chatId);

  if (mode === "voice") {
    const timestamp = Date.now();
    const mp3Path = path.resolve(`text_speech_${timestamp}.mp3`);
    const oggPath = path.resolve(`text_speech_${timestamp}.ogg`);

    try {
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
        ...mainMenu,
      });
    } finally {
      cleanupFiles([mp3Path, oggPath]);
    }

    return;
  }

  await bot.sendMessage(chatId, translatedText, mainMenu);
}

async function showMainMenu(chatId) {
  const currentLanguage = getTargetLanguage(chatId);
  const outputMode = getOutputMode(chatId) === "voice" ? "🔊 Голос" : "📝 Текст";

  await bot.sendMessage(
    chatId,
    `🤖 AI Translator Bot\n\nТекущий язык перевода: ${currentLanguage}\nФормат ответа: ${outputMode}\n\nОтправьте текст, голосовое или картинку с текстом.`,
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

async function showOutputModeMenu(chatId) {
  await bot.sendMessage(chatId, "🔊 Выберите формат ответа:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📝 Текст", callback_data: "mode_text" },
          { text: "🔊 Голос", callback_data: "mode_voice" },
        ],
      ],
    },
  });
}

async function showHelp(chatId) {
  await bot.sendMessage(
    chatId,
    `ℹ️ Как пользоваться ботом:

1. Нажмите «🌍 Выбрать язык»
2. Выберите язык перевода
3. Нажмите «🔊 Режим ответа»
4. Выберите: текст или голос
5. Отправьте:
   📝 текст
   🎤 голосовое
   🖼 картинку с текстом

Команды:
/start — главное меню
/language — выбрать язык
/mode — формат ответа
/status — текущие настройки
/help — помощь

По умолчанию:
язык — Russian
ответ — текст`,
    mainMenu
  );
}

bot.setMyCommands([
  { command: "start", description: "Главное меню" },
  { command: "language", description: "Выбрать язык перевода" },
  { command: "mode", description: "Выбрать формат ответа" },
  { command: "status", description: "Показать настройки" },
  { command: "help", description: "Помощь" },
]);

bot.onText(/\/start/, async (msg) => {
  await showMainMenu(msg.chat.id);
});

bot.onText(/\/language/, async (msg) => {
  await showLanguageMenu(msg.chat.id);
});

bot.onText(/\/mode/, async (msg) => {
  await showOutputModeMenu(msg.chat.id);
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const currentLanguage = getTargetLanguage(chatId);
  const outputMode = getOutputMode(chatId) === "voice" ? "🔊 Голос" : "📝 Текст";

  await bot.sendMessage(
    chatId,
    `📌 Текущие настройки:\n\nЯзык: ${currentLanguage}\nФормат ответа: ${outputMode}`,
    mainMenu
  );
});

bot.onText(/\/help/, async (msg) => {
  await showHelp(msg.chat.id);
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("mode_")) {
    const mode = data.replace("mode_", "");

    userOutputModes[chatId] = mode;
    saveJson(outputModesFile, userOutputModes);

    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(
      chatId,
      `✅ Формат ответа сохранён: ${mode === "voice" ? "🔊 Голос" : "📝 Текст"}`,
      mainMenu
    );
    return;
  }

  if (data.startsWith("lang_")) {
    const langCode = data.replace("lang_", "");

    if (!languages[langCode]) {
      await bot.answerCallbackQuery(query.id, {
        text: "Неизвестный язык",
      });
      return;
    }

    userLanguages[chatId] = languages[langCode];
    saveJson(languagesFile, userLanguages);

    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(
      chatId,
      `✅ Язык сохранён: ${languages[langCode]}\nТеперь можно отправлять текст, голос или картинку.`,
      mainMenu
    );
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const targetLanguage = getTargetLanguage(chatId);

  if (!msg.text) return;

  if (msg.text === "🌍 Выбрать язык") {
    await showLanguageMenu(chatId);
    return;
  }

  if (msg.text === "📌 Текущий язык") {
    const outputMode = getOutputMode(chatId) === "voice" ? "🔊 Голос" : "📝 Текст";
    await bot.sendMessage(
      chatId,
      `📌 Текущие настройки:\n\nЯзык: ${targetLanguage}\nФормат ответа: ${outputMode}`,
      mainMenu
    );
    return;
  }

  if (msg.text === "🔊 Режим ответа") {
    await showOutputModeMenu(chatId);
    return;
  }

  if (msg.text === "ℹ️ Помощь") {
    await showHelp(chatId);
    return;
  }

  if (msg.text === "🧹 Очистить язык") {
    delete userLanguages[chatId];
    delete userOutputModes[chatId];

    saveJson(languagesFile, userLanguages);
    saveJson(outputModesFile, userOutputModes);

    await bot.sendMessage(
      chatId,
      "🧹 Настройки сброшены.\nЯзык по умолчанию: Russian\nФормат ответа: текст.",
      mainMenu
    );
    return;
  }

  if (msg.text.startsWith("/")) return;

  try {
    await bot.sendMessage(chatId, `📝 Перевожу на ${targetLanguage}...`);
    const translatedText = await translateText(msg.text, targetLanguage);
    await sendTranslation(chatId, translatedText);
  } catch (error) {
    console.error("Text translation error:", error);
    await bot.sendMessage(chatId, "❌ Ошибка перевода текста.", mainMenu);
  }
});

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const targetLanguage = getTargetLanguage(chatId);

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
    await sendTranslation(chatId, `🖼 Перевод с картинки:\n\n${translatedText}`);
  } catch (error) {
    console.error("Image OCR error:", error);
    await bot.sendMessage(chatId, "❌ Ошибка распознавания картинки.", mainMenu);
  } finally {
    cleanupFiles([imagePath]);
  }
});

bot.on("voice", async (msg) => {
  const chatId = msg.chat.id;
  const targetLanguage = getTargetLanguage(chatId);

  const timestamp = Date.now();
  const inputPath = path.resolve(`voice_${timestamp}.ogg`);

  try {
    await bot.sendMessage(chatId, `🎧 Перевожу на ${targetLanguage}...`);

    await downloadTelegramFile(msg.voice.file_id, inputPath);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(inputPath),
      model: "gpt-4o-mini-transcribe",
    });

    const translatedText = await translateText(transcription.text, targetLanguage);
    await sendTranslation(chatId, translatedText);
  } catch (error) {
    console.error("Voice translation error:", error);
    await bot.sendMessage(chatId, "❌ Ошибка обработки голосового.", mainMenu);
  } finally {
    cleanupFiles([inputPath]);
  }
});