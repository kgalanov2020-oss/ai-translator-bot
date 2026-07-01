const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const targetLanguage = document.querySelector("#targetLanguage");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const sourceTranscript = document.querySelector("#sourceTranscript");
const translatedTranscript = document.querySelector("#translatedTranscript");

let peerConnection;
let sourceStream;
let translatedAudio;
let eventsChannel;

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

async function startTranslation() {
  startButton.disabled = true;
  stopButton.disabled = false;
  targetLanguage.disabled = true;
  resetTranscripts();
  setStatus("Подключаю микрофон", "connecting");

  try {
    const clientSecret = await createClientSecret(targetLanguage.value);

    sourceStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

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
    setStatus(error.message, "error");
    stopTranslation();
  }
}

function stopTranslation() {
  sourceStream?.getTracks().forEach((track) => track.stop());
  peerConnection?.close();

  sourceStream = undefined;
  peerConnection = undefined;
  eventsChannel = undefined;

  if (translatedAudio) {
    translatedAudio.srcObject = null;
    translatedAudio = undefined;
  }

  startButton.disabled = false;
  stopButton.disabled = true;
  targetLanguage.disabled = false;

  if (statusDot.dataset.state !== "error") {
    setStatus("Остановлено", "idle");
  }
}

startButton.addEventListener("click", startTranslation);
stopButton.addEventListener("click", stopTranslation);
