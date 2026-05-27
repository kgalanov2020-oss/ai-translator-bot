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

const keyboard = Object.entries(languages).reduce((rows, [code, name], i) => {
  if (i % 2 === 0) rows.push([]);
  rows[rows.length - 1].push({ text: name, callback_data: `lang_${code}` });
  return rows;
}, []);

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

console.log("Voice/Text/Image Translator Bot started...");

async function translateText(text, targetLanguage) {
  const result = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Translate the user's text into ${targetLanguage}. Return only the translated text.`,
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
  });

  const writer = fs.createWriteStream(outputPath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const savedLanguage = userLanguages[chatId];

  await bot.sendMessage(
    chatId,
    savedLanguage
      ? `Текущий язык: ${savedLanguage}\nВыберите новый язык или отправьте текст, голос или картинку.`
      : "Выберите язык перевода:",
    {
      reply_markup: {
        inline_keyboard: keyboard,
      },
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
    `✅ Язык сохранён: ${languages[langCode]}\nТеперь можно отправлять текст, голос или картинку.`
  );
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const targetLanguage = userLanguages[chatId] || "English";

  if (msg.text && msg.text !== "/start") {
    try {
      await bot.sendMessage(chatId, `📝 Перевожу на ${targetLanguage}...`);

      const translatedText = await translateText(msg.text, targetLanguage);

      await bot.sendMessage(chatId, translatedText);
    } catch (error) {
      console.error(error);
      await bot.sendMessage(chatId, "❌ Ошибка перевода текста.");
    }
  }
});

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const targetLanguage = userLanguages[chatId] || "English";

  const timestamp = Date.now();
  const imagePath = path.resolve(`image_${timestamp}.jpg`);

  try {
    await bot.sendMessage(chatId, `🖼 Распознаю текст на картинке и перевожу на ${targetLanguage}...`);

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

    await bot.sendMessage(chatId, `🖼 Перевод с картинки:\n\n${translatedText}`);

    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
  } catch (error) {
    console.error(error);
    await bot.sendMessage(chatId, "❌ Ошибка распознавания картинки.");
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

    [inputPath, mp3Path, oggPath].forEach((file) => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
  } catch (error) {
    console.error(error);
    await bot.sendMessage(chatId, "❌ Ошибка обработки голосового.");
  }
});