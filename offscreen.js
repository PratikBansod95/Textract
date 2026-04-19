const DEFAULT_LANG = 'eng';
const workerReadyByLang = {};

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'TEXTLENS_OFFSCREEN_OCR_REQUEST') {
    return;
  }

  runOcr(message)
    .then((payload) => {
      chrome.runtime.sendMessage({
        type: 'TEXTLENS_OFFSCREEN_OCR_RESULT',
        requestId: message.requestId,
        payload
      });
    })
    .catch((error) => {
      chrome.runtime.sendMessage({
        type: 'TEXTLENS_OFFSCREEN_OCR_RESULT',
        requestId: message.requestId,
        payload: {
          ok: false,
          error: getErrorMessage(error, 'OCR processing failed')
        }
      });
    });
});

async function runOcr(message) {
  const imageDataUrl = message?.imageDataUrl;
  if (!imageDataUrl) {
    return { ok: false, error: 'No image data was provided.' };
  }

  const languageCode = DEFAULT_LANG;
  const worker = await getWorker(languageCode);
  const { data } = await worker.recognize(imageDataUrl);
  return {
    ok: true,
    text: (data?.text || '').trim()
  };
}

async function getWorker(languageCode) {
  if (!workerReadyByLang[languageCode]) {
    workerReadyByLang[languageCode] = (async () => {
      try {
        const worker = await Tesseract.createWorker({
          workerPath: chrome.runtime.getURL('lib/worker.min.js'),
          corePath: chrome.runtime.getURL('lib/tesseract-core.wasm.js'),
          langPath: chrome.runtime.getURL('lib/lang-data'),
          workerBlobURL: false
        });

        await worker.loadLanguage(languageCode);
        await worker.initialize(languageCode);
        return worker;
      } catch (error) {
        delete workerReadyByLang[languageCode];
        throw error;
      }
    })();
  }

  return workerReadyByLang[languageCode];
}

function getErrorMessage(error, fallback) {
  if (typeof error === 'string' && error) {
    return error;
  }
  if (error && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return fallback;
}
