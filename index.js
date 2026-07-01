import "dotenv/config";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";
import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const execFileAsync = promisify(execFile);

const DATA_DIR = path.resolve("data");
const TEMP_DIR = path.resolve("tmp");
const USER_LANGUAGES_FILE = path.join(DATA_DIR, "userLanguages.json");
const USER_OUTPUT_MODES_FILE = path.join(DATA_DIR, "userOutputModes.json");
const LEGACY_USER_LANGUAGES_FILE = path.resolve("userLanguages.json");
const LEGACY_USER_OUTPUT_MODES_FILE = path.resolve("userOutputModes.json");

const DEFAULT_LANGUAGE = process.env.DEFAULT_LANGUAGE || "Russian";
const DEFAULT_OUTPUT_MODE = process.env.DEFAULT_OUTPUT_MODE || "text";
const TRANSLATION_MODEL = process.env.OPENAI_TRANSLATION_MODEL || "gpt-4o-mini";
const OCR_MODEL = process.env.OPENAI_OCR_MODEL || TRANSLATION_MODEL;
const TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "alloy";
const MAX_TELEGRAM_MESSAGE_LENGTH = 3900;
const LANGUAGE_PAGE_SIZE = 16;

const requiredEnv = ["TELEGRAM_BOT_TOKEN", "OPENAI_API_KEY"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());

if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  console.error("Create .env from .env.example and fill in the values.");
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });

function loadJson(file, fallbackFile) {
  const source = fs.existsSync(file) ? file : fallbackFile && fs.existsSync(fallbackFile) ? fallbackFile : null;

  if (!source) return {};

  try {
    return JSON.parse(fs.readFileSync(source, "utf8"));
  } catch (error) {
    console.error(`Failed to read ${source}:`, error.message);
    return {};
  }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, file);
}

const userLanguages = loadJson(USER_LANGUAGES_FILE, LEGACY_USER_LANGUAGES_FILE);
const userOutputModes = loadJson(USER_OUTPUT_MODES_FILE, LEGACY_USER_OUTPUT_MODES_FILE);

const languages = {
  af: "Afrikaans",
  sq: "Albanian",
  am: "Amharic",
  ar: "Arabic",
  as: "Assamese",
  hy: "Armenian",
  az: "Azerbaijani",
  eu: "Basque",
  be: "Belarusian",
  bn: "Bengali",
  bs: "Bosnian",
  bg: "Bulgarian",
  ca: "Catalan",
  ceb: "Cebuano",
  zh: "Chinese",
  hr: "Croatian",
  cs: "Czech",
  da: "Danish",
  nl: "Dutch",
  en: "English",
  eo: "Esperanto",
  et: "Estonian",
  fi: "Finnish",
  fr: "French",
  gl: "Galician",
  ka: "Georgian",
  de: "German",
  el: "Greek",
  gu: "Gujarati",
  ht: "Haitian Creole",
  ha: "Hausa",
  he: "Hebrew",
  hi: "Hindi",
  hu: "Hungarian",
  ig: "Igbo",
  is: "Icelandic",
  id: "Indonesian",
  ga: "Irish",
  it: "Italian",
  ja: "Japanese",
  jv: "Javanese",
  kn: "Kannada",
  kk: "Kazakh",
  km: "Khmer",
  ko: "Korean",
  ku: "Kurdish",
  ky: "Kyrgyz",
  lo: "Lao",
  la: "Latin",
  lv: "Latvian",
  lt: "Lithuanian",
  mk: "Macedonian",
  mg: "Malagasy",
  ms: "Malay",
  ml: "Malayalam",
  mt: "Maltese",
  mi: "Maori",
  mr: "Marathi",
  mn: "Mongolian",
  my: "Burmese",
  ne: "Nepali",
  no: "Norwegian",
  or: "Odia",
  ps: "Pashto",
  fa: "Persian",
  pl: "Polish",
  pt: "Portuguese",
  pa: "Punjabi",
  ro: "Romanian",
  rw: "Kinyarwanda",
  ru: "Russian",
  sd: "Sindhi",
  sr: "Serbian",
  si: "Sinhala",
  sk: "Slovak",
  sl: "Slovenian",
  sn: "Shona",
  so: "Somali",
  es: "Spanish",
  su: "Sundanese",
  sw: "Swahili",
  sv: "Swedish",
  tl: "Tagalog",
  tg: "Tajik",
  ta: "Tamil",
  tt: "Tatar",
  te: "Telugu",
  th: "Thai",
  tr: "Turkish",
  uk: "Ukrainian",
  ug: "Uyghur",
  ur: "Urdu",
  uz: "Uzbek",
  vi: "Vietnamese",
  cy: "Welsh",
  xh: "Xhosa",
  yi: "Yiddish",
  yo: "Yoruba",
  zu: "Zulu",
};

const languageEntries = Object.entries(languages);
const languagePageCount = Math.ceil(languageEntries.length / LANGUAGE_PAGE_SIZE);

function createLanguageKeyboard(page = 0) {
  const safePage = Math.min(Math.max(page, 0), languagePageCount - 1);
  const pageEntries = languageEntries.slice(
    safePage * LANGUAGE_PAGE_SIZE,
    safePage * LANGUAGE_PAGE_SIZE + LANGUAGE_PAGE_SIZE
  );

  const rows = pageEntries.reduce((keyboardRows, [code, name], index) => {
    if (index % 2 === 0) keyboardRows.push([]);
    keyboardRows[keyboardRows.length - 1].push({
      text: name,
      callback_data: `lang_${code}`,
    });
    return keyboardRows;
  }, []);

  rows.push([
    {
      text: safePage > 0 ? "← Назад" : " ",
      callback_data: safePage > 0 ? `langpage_${safePage - 1}` : `langpage_${safePage}`,
    },
    {
      text: `${safePage + 1}/${languagePageCount}`,
      callback_data: `langpage_${safePage}`,
    },
    {
      text: safePage < languagePageCount - 1 ? "Вперед →" : " ",
      callback_data:
        safePage < languagePageCount - 1 ? `langpage_${safePage + 1}` : `langpage_${safePage}`,
    },
  ]);

  return rows;
}

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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

console.log("AI Translator Bot started.");

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

function getTargetLanguage(chatId) {
  return userLanguages[chatId] || DEFAULT_LANGUAGE;
}

function getOutputMode(chatId) {
  const mode = userOutputModes[chatId] || DEFAULT_OUTPUT_MODE;
  return mode === "voice" ? "voice" : "text";
}

function createTempPath(prefix, extension) {
  return path.join(TEMP_DIR, `${prefix}_${Date.now()}_${randomUUID()}.${extension}`);
}

function cleanupFiles(files) {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (error) {
      console.error(`Failed to remove ${file}:`, error.message);
    }
  }
}

function getErrorDetails(error) {
  return {
    name: error?.name,
    status: error?.status,
    code: error?.code,
    type: error?.type,
    message: error?.message,
  };
}

function getUserFacingError(error, fallbackMessage) {
  if (error?.status === 401) {
    return "❌ OpenAI API ключ не принят. Проверьте OPENAI_API_KEY в .env.";
  }

  if (error?.status === 429 || error?.code === "insufficient_quota") {
    return "❌ OpenAI API временно недоступен из-за лимита, квоты или баланса.";
  }

  if (error?.status === 400 && error?.code === "model_not_found") {
    return "❌ Модель OpenAI недоступна для этого ключа. Проверьте настройки моделей в .env.";
  }

  return fallbackMessage;
}

function splitTelegramMessage(text) {
  if (text.length <= MAX_TELEGRAM_MESSAGE_LENGTH) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
    let splitAt = remaining.lastIndexOf("\n", MAX_TELEGRAM_MESSAGE_LENGTH);
    if (splitAt < MAX_TELEGRAM_MESSAGE_LENGTH * 0.5) {
      splitAt = remaining.lastIndexOf(" ", MAX_TELEGRAM_MESSAGE_LENGTH);
    }
    if (splitAt < MAX_TELEGRAM_MESSAGE_LENGTH * 0.5) splitAt = MAX_TELEGRAM_MESSAGE_LENGTH;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendLongMessage(chatId, text, options = mainMenu) {
  const chunks = splitTelegramMessage(text);

  for (let index = 0; index < chunks.length; index += 1) {
    const isLastChunk = index === chunks.length - 1;
    await bot.sendMessage(chatId, chunks[index], isLastChunk ? options : undefined);
  }
}

async function translateText(text, targetLanguage) {
  const result = await openai.chat.completions.create({
    model: TRANSLATION_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `You are a professional translator. Detect the source language and translate the user's message into ${targetLanguage}. Preserve meaning, tone, formatting, names, numbers, and units. Return only the translated text.`,
      },
      {
        role: "user",
        content: text,
      },
    ],
  });

  return result.choices[0]?.message?.content?.trim() || "";
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
    response.data.on("error", reject);
  });
}

async function sendTranslation(chatId, translatedText) {
  const mode = getOutputMode(chatId);

  if (mode === "voice") {
    const mp3Path = createTempPath("speech", "mp3");
    const oggPath = createTempPath("speech", "ogg");

    try {
      const speech = await openai.audio.speech.create({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: translatedText,
      });

      fs.writeFileSync(mp3Path, Buffer.from(await speech.arrayBuffer()));

      await execFileAsync(ffmpegInstaller.path, [
        "-y",
        "-i",
        mp3Path,
        "-c:a",
        "libopus",
        "-f",
        "ogg",
        oggPath,
      ]);

      await bot.sendVoice(chatId, oggPath, mainMenu);

      if (translatedText.length <= 1024) {
        await bot.sendMessage(chatId, `📝 ${translatedText}`, mainMenu);
      } else {
        await sendLongMessage(chatId, `📝 ${translatedText}`, mainMenu);
      }
    } finally {
      cleanupFiles([mp3Path, oggPath]);
    }

    return;
  }

  await sendLongMessage(chatId, translatedText, mainMenu);
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

async function showLanguageMenu(chatId, page = 0, messageId) {
  const safePage = Math.min(Math.max(page, 0), languagePageCount - 1);
  const text = `🌍 Выберите язык перевода:\nПоказано ${languageEntries.length} языков. Страница ${safePage + 1}/${languagePageCount}`;
  const options = {
    reply_markup: {
      inline_keyboard: createLanguageKeyboard(safePage),
    },
  };

  if (messageId) {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      ...options,
    });
    return;
  }

  await bot.sendMessage(chatId, text, options);
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
язык — ${DEFAULT_LANGUAGE}
ответ — ${DEFAULT_OUTPUT_MODE === "voice" ? "голос" : "текст"}`,
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
  const chatId = query.message?.chat?.id;
  const data = query.data || "";

  if (!chatId) {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith("mode_")) {
    const mode = data.replace("mode_", "");

    if (!["text", "voice"].includes(mode)) {
      await bot.answerCallbackQuery(query.id, { text: "Неизвестный режим" });
      return;
    }

    userOutputModes[chatId] = mode;
    saveJson(USER_OUTPUT_MODES_FILE, userOutputModes);

    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(
      chatId,
      `✅ Формат ответа сохранён: ${mode === "voice" ? "🔊 Голос" : "📝 Текст"}`,
      mainMenu
    );
    return;
  }

  if (data.startsWith("langpage_")) {
    const page = Number(data.replace("langpage_", ""));
    await bot.answerCallbackQuery(query.id);
    await showLanguageMenu(chatId, Number.isFinite(page) ? page : 0, query.message.message_id);
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
    saveJson(USER_LANGUAGES_FILE, userLanguages);

    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(
      chatId,
      `✅ Язык сохранён: ${languages[langCode]}\nТеперь можно отправлять текст, голос или картинку.`,
      mainMenu
    );
    return;
  }

  await bot.answerCallbackQuery(query.id);
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

    saveJson(USER_LANGUAGES_FILE, userLanguages);
    saveJson(USER_OUTPUT_MODES_FILE, userOutputModes);

    await bot.sendMessage(
      chatId,
      `🧹 Настройки сброшены.\nЯзык по умолчанию: ${DEFAULT_LANGUAGE}\nФормат ответа: текст.`,
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
    console.error("Text translation error:", getErrorDetails(error));
    await bot.sendMessage(
      chatId,
      getUserFacingError(error, "❌ Ошибка перевода текста."),
      mainMenu
    );
  }
});

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const targetLanguage = getTargetLanguage(chatId);
  const imagePath = createTempPath("image", "jpg");

  try {
    await bot.sendMessage(
      chatId,
      `🖼 Распознаю текст на картинке и перевожу на ${targetLanguage}...`
    );

    const photo = msg.photo[msg.photo.length - 1];
    await downloadTelegramFile(photo.file_id, imagePath);

    const imageBase64 = fs.readFileSync(imagePath, "base64");

    const result = await openai.chat.completions.create({
      model: OCR_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `Extract all readable text from the image, then translate it into ${targetLanguage}. Return only the translated text. If no text is readable, say that no readable text was found in ${targetLanguage}.`,
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

    const translatedText = result.choices[0]?.message?.content?.trim() || "";
    await sendTranslation(chatId, `🖼 Перевод с картинки:\n\n${translatedText}`);
  } catch (error) {
    console.error("Image OCR error:", getErrorDetails(error));
    await bot.sendMessage(
      chatId,
      getUserFacingError(error, "❌ Ошибка распознавания картинки."),
      mainMenu
    );
  } finally {
    cleanupFiles([imagePath]);
  }
});

bot.on("voice", async (msg) => {
  const chatId = msg.chat.id;
  const targetLanguage = getTargetLanguage(chatId);
  const inputPath = createTempPath("voice", "ogg");

  try {
    await bot.sendMessage(chatId, `🎧 Перевожу на ${targetLanguage}...`);

    await downloadTelegramFile(msg.voice.file_id, inputPath);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(inputPath),
      model: TRANSCRIPTION_MODEL,
    });

    const translatedText = await translateText(transcription.text, targetLanguage);
    await sendTranslation(chatId, translatedText);
  } catch (error) {
    console.error("Voice translation error:", getErrorDetails(error));
    await bot.sendMessage(
      chatId,
      getUserFacingError(error, "❌ Ошибка обработки голосового."),
      mainMenu
    );
  } finally {
    cleanupFiles([inputPath]);
  }
});
