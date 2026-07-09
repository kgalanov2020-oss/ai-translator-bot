const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const micTestButton = document.querySelector("#micTestButton");
const targetLanguage = document.querySelector("#targetLanguage");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const sourceTranscript = document.querySelector("#sourceTranscript");
const translatedTranscript = document.querySelector("#translatedTranscript");

let peerConnection;
let sourceStream;
let translatedAudio;
let eventsChannel;
let translationStarting = false;

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
    return "Доступ к микрофону запрещен. Нажмите значок слева от адреса, разрешите микрофон и обновите страницу.";
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
  if (peerConnection || translationStarting) return;

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
  } finally {
    translationStarting = false;
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
    setStatus("Микрофон разрешен. Можно нажать «Старт».", "live");
  } catch (error) {
    setStatus(getFriendlyError(error), "error");
  } finally {
    micTestButton.disabled = false;
  }
}

startButton.addEventListener("click", startTranslation);
stopButton.addEventListener("click", stopTranslation);
micTestButton.addEventListener("click", testMicrophone);
