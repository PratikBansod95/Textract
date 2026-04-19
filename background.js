const MENU_ID = 'textlens-copy-image-text';
const OFFSCREEN_URL = 'offscreen.html';
let offscreenReadyPromise = null;

chrome.runtime.onInstalled.addListener(registerContextMenu);
chrome.runtime.onStartup.addListener(registerContextMenu);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id || !info.srcUrl) {
    return;
  }

  try {
    const response = await fetch(info.srcUrl);
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);

    await chrome.tabs.sendMessage(tab.id, {
      type: 'TEXTLENS_OCR_IMAGE',
      imageDataUrl: dataUrl
    });
  } catch (error) {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'TEXTLENS_OCR_ERROR',
      message: `Unable to read that image: ${getErrorMessage(error, 'Unknown error')}`
    }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'TEXTLENS_CAPTURE_VISIBLE') {
    const windowId = sender.tab?.windowId;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true, dataUrl });
    });
    return true;
  }

  if (message?.type === 'TEXTLENS_RUN_OCR') {
    runOcrInOffscreen(message.imageDataUrl)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error, 'OCR execution failed') });
      });
    return true;
  }

  if (message?.type === 'TEXTLENS_TRIGGER_SELECTION') {
    triggerSelectionOnActiveTab().then(sendResponse);
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'start-selection-ocr') {
    return;
  }

  await triggerSelectionOnActiveTab();
});

async function runOcrInOffscreen(imageDataUrl) {
  await ensureOffscreenDocument();

  const requestId = createRequestId();

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve({ ok: false, error: 'OCR timed out. Please try again.' });
    }, 120000);

    function onMessage(message) {
      if (message?.type !== 'TEXTLENS_OFFSCREEN_OCR_RESULT' || message.requestId !== requestId) {
        return;
      }

      clearTimeout(timeoutId);
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve(message.payload || { ok: false, error: 'OCR failed' });
    }

    chrome.runtime.onMessage.addListener(onMessage);

    chrome.runtime.sendMessage({
      type: 'TEXTLENS_OFFSCREEN_OCR_REQUEST',
      requestId,
      imageDataUrl
    }).catch((error) => {
      clearTimeout(timeoutId);
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve({ ok: false, error: getErrorMessage(error, 'Unable to send OCR request') });
    });
  });
}

async function triggerSelectionOnActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    return { ok: false, error: 'No active tab found.' };
  }

  try {
    await ensureContentReady(activeTab.id);
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, 'Cannot run on this page.') };
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(activeTab.id, { type: 'TEXTLENS_START_SELECTION' }, () => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve({ ok: true });
    });
  });
}

async function ensureContentReady(tabId) {
  const pingOk = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'TEXTLENS_PING' }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        resolve(false);
        return;
      }
      resolve(true);
    });
  });

  if (pingOk) {
    return;
  }

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['content.css']
  }).catch(() => {});

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
}

async function ensureOffscreenDocument() {
  if (offscreenReadyPromise) {
    return offscreenReadyPromise;
  }

  offscreenReadyPromise = (async () => {
    if (!chrome.offscreen) {
      throw new Error('Offscreen API not available in this Chrome version.');
    }

    if (typeof chrome.offscreen.hasDocument === 'function') {
      const hasDocument = await chrome.offscreen.hasDocument();
      if (hasDocument) {
        return;
      }
    }

    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['WORKERS'],
        justification: 'Run local OCR in extension context to avoid site CSP worker restrictions.'
      });
    } catch (error) {
      const msg = getErrorMessage(error, '');
      if (!/single offscreen document/i.test(msg)) {
        offscreenReadyPromise = null;
        throw error;
      }
    }
  })();

  return offscreenReadyPromise;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(blob);
  });
}

function registerContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Copy text from image',
      contexts: ['image']
    });
  });
}

function createRequestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
