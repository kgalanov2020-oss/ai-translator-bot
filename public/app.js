const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const micTestButton = document.querySelector("#micTestButton");
const targetLanguage = document.querySelector("#targetLanguage");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const sourceTranscript = document.querySelector("#sourceTranscript");
const translatedTranscript = document.querySelector("#translatedTranscript");
const startTestButton = document.querySelector("#startTestButton");
const markHeardButton = document.querySelector("#markHeardButton");
const saveResultButton = document.querySelector("#saveResultButton");
const exportCsvButton = document.querySelector("#exportCsvButton");
const exportJsonButton = document.querySelector("#exportJsonButton");
const clearResultsButton = document.querySelector("#clearResultsButton");
const testScenario = document.querySelector("#testScenario");
const testPhrase = document.querySelector("#testPhrase");
const qualityScore = document.querySelector("#qualityScore");
const activePhrase = document.querySelector("#activePhrase");
const resultCount = document.querySelector("#resultCount");
const averageLatency = document.querySelector("#averageLatency");
const averageQuality = document.querySelector("#averageQuality");
const resultsTable = document.querySelector("#resultsTable");

let peerConnection;
let sourceStream;
let translatedAudio;
let eventsChannel;
let activeTest;
let translationStarting = false;
let pendingStartPromise;

const testPhrases = [
  "Привет, как дела?",
  "Где находится ближайшая станция метро?",
  "Мне нужна помощь с переводом.",
  "Сколько это стоит?",
  "Повторите, пожалуйста, медленнее.",
  "Я хочу заказать кофе и воду.",
  "Мы встретимся через десять минут.",
  "Можно оплатить картой?",
];

const storedResults = localStorage.getItem("translatorTestResults");
let testResults = storedResults ? JSON.parse(storedResults) : [];

for (const phrase of testPhrases) {
  const option = document.createElement("option");
  option.value = phrase;
  option.textContent = phrase;
  testPhrase.append(option);
}

function setStatus(text, state = "idle") {
  statusText.textContent = text;
  statusDot.dataset.state = state;
}

function appendText(node, text) {
  node.textContent += text;
  node.scrollTop = node.scrollHeight;
}

function resetTranscripts() {
  sourceTranscript.textContent = "";
  translatedTranscript.textContent = "";
}

function formatLatency(milliseconds) {
  return `${(milliseconds / 1000).toFixed(2)} сек`;
}

function saveResultsToStorage() {
  localStorage.setItem("translatorTestResults", JSON.stringify(testResults));
}

function updateResultsView() {
  resultsTable.innerHTML = "";

  for (const result of testResults) {
    const row = document.createElement("tr");
    const cells = [
      new Date(result.createdAt).toLocaleTimeString(),
      result.scenario,
      result.language,
      result.phrase,
      formatLatency(result.latencyMs),
      `${result.quality}/5`,
    ];

    for (const cellText of cells) {
      const cell = document.createElement("td");
      cell.textContent = cellText;
      row.append(cell);
    }

    resultsTable.prepend(row);
  }

  const count = testResults.length;
  const avgLatency =
    count > 0 ? testResults.reduce((sum, item) => sum + item.latencyMs, 0) / count : 0;
  const avgQuality =
    count > 0 ? testResults.reduce((sum, item) => sum + item.quality, 0) / count : 0;

  resultCount.textContent = `${count} тестов`;
  averageLatency.textContent = count > 0 ? `Средняя задержка: ${formatLatency(avgLatency)}` : "Средняя задержка: -";
  averageQuality.textContent = count > 0 ? `Среднее качество: ${avgQuality.toFixed(1)}/5` : "Среднее качество: -";

  exportCsvButton.disabled = count === 0;
  exportJsonButton.disabled = count === 0;
  clearResultsButton.disabled = count === 0;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const headers = ["createdAt", "scenario", "language", "phrase", "latencyMs", "quality"];
  const rows = testResults.map((result) =>
    headers
      .map((key) => `"${String(result[key]).replaceAll('"', '""')}"`)
      .join(",")
  );
  downloadFile("translator-tests.csv", [headers.join(","), ...rows].join("\n"), "text/csv");
}

function exportJson() {
  downloadFile(
    "translator-tests.json",
    JSON.stringify(testResults, null, 2),
    "application/json"
  );
}

async function createClientSecret(language) {
  const response = await fetch("/api/realtime-translation/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetLanguage: language }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Не удалось создать live-сессию");
  }

  if (!data.value) {
    throw new Error("Сервер не вернул client secret");
  }

  return data.value;
}

function handleRealtimeEvent(event) {
  if (event.type === "session.input_transcript.delta") {
    appendText(sourceTranscript, event.delta);
    return;
  }

  if (event.type === "session.output_transcript.delta") {
    appendText(translatedTranscript, event.delta);
    return;
  }

  if (event.type === "error") {
    setStatus(event.error?.message || "Ошибка live-сессии", "error");
  }
}

function getFriendlyError(error) {
  if (error?.name === "NotAllowedError" || error?.message === "Permission denied") {
    return "Доступ к микрофону запрещен. Откройте страницу в Chrome или Edge, нажмите значок слева от адреса, разрешите микрофон и обновите страницу.";
  }

  if (error?.name === "NotFoundError") {
    return "Микрофон не найден. Подключите гарнитуру или выберите микрофон в настройках Windows.";
  }

  if (error?.name === "NotReadableError") {
    return "Микрофон занят другой программой. Закройте приложения, которые используют микрофон, и попробуйте снова.";
  }

  return error?.message || "Ошибка live-перевода";
}

async function requestMicrophone() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

async function startTranslation() {
  if (peerConnection) return;
  if (translationStarting && pendingStartPromise) return pendingStartPromise;

  pendingStartPromise = doStartTranslation();
  return pendingStartPromise;
}

async function doStartTranslation() {
  translationStarting = true;
  startButton.disabled = true;
  micTestButton.disabled = true;
  stopButton.disabled = false;
  targetLanguage.disabled = true;
  resetTranscripts();
  setStatus("Подключаю микрофон", "connecting");

  try {
    const clientSecret = await createClientSecret(targetLanguage.value);

    sourceStream = await requestMicrophone();

    peerConnection = new RTCPeerConnection();
    peerConnection.addTrack(sourceStream.getAudioTracks()[0], sourceStream);

    translatedAudio = new Audio();
    translatedAudio.autoplay = true;

    peerConnection.ontrack = ({ streams }) => {
      translatedAudio.srcObject = streams[0];
      translatedAudio.play().catch(() => {});
    };

    eventsChannel = peerConnection.createDataChannel("oai-events");
    eventsChannel.onopen = () => setStatus("Перевод идет", "live");
    eventsChannel.onmessage = ({ data }) => handleRealtimeEvent(JSON.parse(data));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const sdpResponse = await fetch(
      "https://api.openai.com/v1/realtime/translations/calls",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      }
    );

    if (!sdpResponse.ok) {
      throw new Error(await sdpResponse.text());
    }

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text(),
    });
  } catch (error) {
    setStatus(getFriendlyError(error), "error");
    stopTranslation();
    throw error;
  } finally {
    translationStarting = false;
    pendingStartPromise = undefined;
    micTestButton.disabled = false;
  }
}

function stopTranslation() {
  sourceStream?.getTracks().forEach((track) => track.stop());
  peerConnection?.close();

  sourceStream = undefined;
  peerConnection = undefined;
  eventsChannel = undefined;
  translationStarting = false;

  if (translatedAudio) {
    translatedAudio.srcObject = null;
    translatedAudio = undefined;
  }

  startButton.disabled = false;
  stopButton.disabled = true;
  micTestButton.disabled = false;
  targetLanguage.disabled = false;

  if (statusDot.dataset.state !== "error") {
    setStatus("Остановлено", "idle");
  }
}

async function testMicrophone() {
  micTestButton.disabled = true;
  setStatus("Проверяю микрофон", "connecting");

  try {
    const stream = await requestMicrophone();
    stream.getTracks().forEach((track) => track.stop());
    setStatus("Микрофон разрешен. Теперь можно нажать «Старт» или «Начать тест».", "live");
  } catch (error) {
    setStatus(getFriendlyError(error), "error");
  } finally {
    micTestButton.disabled = false;
  }
}

async function startTest() {
  startTestButton.disabled = true;
  saveResultButton.disabled = true;
  markHeardButton.disabled = true;

  if (!peerConnection) {
    setStatus("Запускаю live-перевод для теста", "connecting");

    try {
      await startTranslation();
    } catch {
      startTestButton.disabled = false;
      return;
    }
  }

  activeTest = {
    startedAt: performance.now(),
    phrase: testPhrase.value,
    scenario: testScenario.options[testScenario.selectedIndex].textContent,
    language: targetLanguage.options[targetLanguage.selectedIndex].textContent,
  };

  activePhrase.textContent = activeTest.phrase;
  markHeardButton.disabled = false;
  saveResultButton.disabled = true;
  startTestButton.disabled = false;
  setStatus("Тест начат. Произнесите фразу и нажмите «Услышал перевод».", "live");
}

function markHeard() {
  if (!activeTest) return;

  activeTest.latencyMs = Math.round(performance.now() - activeTest.startedAt);
  activePhrase.textContent = `${activeTest.phrase} — ${formatLatency(activeTest.latencyMs)}`;
  markHeardButton.disabled = true;
  saveResultButton.disabled = false;
  startTestButton.disabled = false;
}

function saveResult() {
  if (!activeTest?.latencyMs) return;

  testResults.push({
    createdAt: new Date().toISOString(),
    scenario: activeTest.scenario,
    language: activeTest.language,
    phrase: activeTest.phrase,
    latencyMs: activeTest.latencyMs,
    quality: Number(qualityScore.value),
  });

  activeTest = undefined;
  saveResultButton.disabled = true;
  startTestButton.disabled = false;
  activePhrase.textContent = "Результат сохранен";
  saveResultsToStorage();
  updateResultsView();
}

function clearResults() {
  testResults = [];
  activeTest = undefined;
  localStorage.removeItem("translatorTestResults");
  activePhrase.textContent = "Выберите фразу и начните тест";
  markHeardButton.disabled = true;
  saveResultButton.disabled = true;
  updateResultsView();
}

startButton.addEventListener("click", startTranslation);
stopButton.addEventListener("click", stopTranslation);
micTestButton.addEventListener("click", testMicrophone);
startTestButton.addEventListener("click", startTest);
markHeardButton.addEventListener("click", markHeard);
saveResultButton.addEventListener("click", saveResult);
exportCsvButton.addEventListener("click", exportCsv);
exportJsonButton.addEventListener("click", exportJson);
clearResultsButton.addEventListener("click", clearResults);

updateResultsView();
