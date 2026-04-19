(() => {
  if (window.__textlensInjected) {
    return;
  }
  window.__textlensInjected = true;

  const TEXTLENS_PANEL_HOST_ID = 'textract-panel-host';
  const TEXTLENS_YT_BUTTON_HOST_ID = 'textract-youtube-host';

  const state = {
    lastContextPoint: { x: window.innerWidth - 360, y: 80 },
    panelTemplate: null,
    selecting: false,
    ytObserver: null,
    ytIntervalId: null,
    ocrRunId: 0
  };

  init();

  function init() {
    preloadPanelTemplate();

    document.addEventListener(
      'contextmenu',
      (event) => {
        state.lastContextPoint = {
          x: event.clientX,
          y: event.clientY
        };
      },
      true
    );

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'TEXTLENS_PING') {
        sendResponse({ ok: true });
        return true;
      }

      if (message?.type === 'TEXTLENS_OCR_IMAGE') {
        runOcrFlow(message.imageDataUrl, {
          x: state.lastContextPoint.x + 12,
          y: state.lastContextPoint.y + 12
        });
        sendResponse({ ok: true });
      }

      if (message?.type === 'TEXTLENS_START_SELECTION') {
        startSelectionMode();
        sendResponse({ ok: true });
      }

      if (message?.type === 'TEXTLENS_OCR_ERROR') {
        const panel = ensurePanel({ x: state.lastContextPoint.x + 12, y: state.lastContextPoint.y + 12 });
        panel.setStatus(message.message || 'OCR failed.');
        sendResponse({ ok: true });
      }

      return true;
    });

    maybeInstallYoutubeButton();
    window.addEventListener('yt-navigate-finish', maybeInstallYoutubeButton);
    window.addEventListener('popstate', maybeInstallYoutubeButton);

    if (!state.ytIntervalId) {
      state.ytIntervalId = window.setInterval(maybeInstallYoutubeButton, 1500);
    }
  }

  async function preloadPanelTemplate() {
    try {
      const response = await fetch(chrome.runtime.getURL('panel.html'));
      state.panelTemplate = await response.text();
    } catch {
      state.panelTemplate = null;
    }
  }

  function isYoutubePage() {
    return /(^|\.)youtube\.com$/i.test(window.location.hostname);
  }

  function isYoutubeVideoPage() {
    if (!isYoutubePage()) {
      return false;
    }
    return window.location.pathname === '/watch' || window.location.pathname.startsWith('/shorts/');
  }

  function maybeInstallYoutubeButton() {
    if (!isYoutubeVideoPage()) {
      const old = document.getElementById(TEXTLENS_YT_BUTTON_HOST_ID);
      if (old) {
        old.remove();
      }
      return;
    }

    if (document.getElementById(TEXTLENS_YT_BUTTON_HOST_ID)) {
      return;
    }

    const host = document.createElement('div');
    host.id = TEXTLENS_YT_BUTTON_HOST_ID;
    host.style.position = 'fixed';
    host.style.right = '16px';
    host.style.bottom = '88px';
    host.style.zIndex = '2147483645';

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .btn {
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-size: 12px;
          letter-spacing: 0.02em;
          color: #cdd6f4;
          background: linear-gradient(145deg, #26263a, #1e1e2e);
          border: 1px solid #3a3a5a;
          border-radius: 999px;
          padding: 8px 12px;
          cursor: pointer;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
        }
        .btn:hover { border-color: #6f6f9a; }
      </style>
      <button class="btn" id="textlens-capture-frame" title="Capture this frame and run OCR">OCR Frame</button>
    `;

    shadow.getElementById('textlens-capture-frame').addEventListener('click', async () => {
      const panel = ensurePanel({ youtube: true });
      panel.setLoading(true, 'Reading text...');

      try {
        const dataUrl = captureYoutubeFrame();
        if (!dataUrl) {
          panel.setStatus('No readable frame available. Pause the video and try again.');
          return;
        }
        await runOcrFlow(dataUrl, { youtube: true });
      } catch (error) {
        panel.setStatus(`Failed to read frame: ${getErrorMessage(error, 'Unknown error')}`);
      }
    });

    document.documentElement.appendChild(host);
  }

  function captureYoutubeFrame() {
    const video = document.querySelector('video');
    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  function startSelectionMode() {
    if (state.selecting) {
      return;
    }
    state.selecting = true;

    const overlay = document.createElement('div');
    overlay.className = 'textlens-selection-overlay';
    overlay.innerHTML = '<div class="textlens-selection-hint">Drag to select text area (Esc to cancel)</div>';

    const selection = document.createElement('div');
    selection.className = 'textlens-selection-box';
    overlay.appendChild(selection);

    if (document.body) {
      document.body.appendChild(overlay);
    } else {
      document.documentElement.appendChild(overlay);
    }

    let startX = 0;
    let startY = 0;
    let currentRect = null;
    let dragging = false;

    const onMouseDown = (event) => {
      event.preventDefault();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      selection.style.display = 'block';
      updateRect(event.clientX, event.clientY);
    };

    const onMouseMove = (event) => {
      if (!dragging) {
        return;
      }
      updateRect(event.clientX, event.clientY);
    };

    const onMouseUp = async (event) => {
      if (!dragging) {
        cleanup();
        state.selecting = false;
        return;
      }

      dragging = false;
      updateRect(event.clientX, event.clientY);
      cleanup();

      if (!currentRect || currentRect.width < 8 || currentRect.height < 8) {
        state.selecting = false;
        return;
      }

      const panel = ensurePanel({ x: currentRect.right + 12, y: currentRect.top + 12 });
      panel.setLoading(true, 'Reading text...');

      try {
        const captureResponse = await chrome.runtime.sendMessage({ type: 'TEXTLENS_CAPTURE_VISIBLE' });
        if (!captureResponse?.ok) {
          throw new Error(captureResponse?.error || 'Capture failed');
        }

        const cropped = await cropCapturedRegion(captureResponse.dataUrl, currentRect);
        await runOcrFlow(cropped, { x: currentRect.right + 12, y: currentRect.top + 12 });
      } catch (error) {
        panel.setStatus(`Selection OCR failed: ${getErrorMessage(error, 'Capture failed')}`);
      } finally {
        state.selecting = false;
      }
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        cleanup();
        state.selecting = false;
      }
    };

    function updateRect(x, y) {
      const left = Math.min(startX, x);
      const top = Math.min(startY, y);
      const width = Math.abs(x - startX);
      const height = Math.abs(y - startY);
      currentRect = { left, top, width, height, right: left + width, bottom: top + height };

      selection.style.left = `${left}px`;
      selection.style.top = `${top}px`;
      selection.style.width = `${width}px`;
      selection.style.height = `${height}px`;
    }

    function cleanup() {
      overlay.removeEventListener('mousedown', onMouseDown);
      overlay.removeEventListener('mousemove', onMouseMove);
      overlay.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
    }

    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown, true);
  }

  async function cropCapturedRegion(screenDataUrl, rect) {
    const image = await loadImage(screenDataUrl);
    const dpr = window.devicePixelRatio || 1;

    const sx = Math.max(0, Math.floor(rect.left * dpr));
    const sy = Math.max(0, Math.floor(rect.top * dpr));
    const sw = Math.max(1, Math.floor(rect.width * dpr));
    const sh = Math.max(1, Math.floor(rect.height * dpr));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

    return canvas.toDataURL('image/png');
  }

  async function runOcrFlow(imageInput, panelPosition) {
    const panel = ensurePanel(panelPosition);
    const runId = ++state.ocrRunId;
    panel.setLoading(true, 'Reading text...');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TEXTLENS_RUN_OCR',
        imageDataUrl: imageInput
      });

      if (runId !== state.ocrRunId) {
        return;
      }

      if (!response?.ok) {
        throw new Error(response?.error || 'OCR request failed');
      }

      const text = (response?.text || '').trim();
      if (!text) {
        panel.setText('No readable text detected.');
      } else {
        panel.setText(text);
      }
    } catch (error) {
      if (runId !== state.ocrRunId) {
        return;
      }
      panel.setStatus(`OCR failed: ${getErrorMessage(error, 'Unknown OCR error')}`);
    }
  }

  function ensurePanel(position = {}) {
    let host = document.getElementById(TEXTLENS_PANEL_HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = TEXTLENS_PANEL_HOST_ID;
      host.style.position = 'fixed';
      host.style.zIndex = '2147483646';
      host.style.top = '24px';
      host.style.right = '24px';
      host.style.width = '360px';
      host.style.height = '280px';
      document.documentElement.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = state.panelTemplate || buildPanelMarkup();
      const styleLink = document.createElement('link');
      styleLink.rel = 'stylesheet';
      styleLink.href = chrome.runtime.getURL('panel.css');
      shadow.appendChild(styleLink);

      const closeButton = shadow.getElementById('textlens-close');
      const header = shadow.querySelector('.textlens-panel-header');
      closeButton.addEventListener('click', () => {
        host.remove();
      });

      const copyButton = shadow.getElementById('textlens-copy');
      const newButton = shadow.getElementById('textlens-new');
      copyButton.addEventListener('click', async () => {
        const textArea = shadow.getElementById('textlens-output');
        const text = textArea.value;
        if (!text) {
          return;
        }

        try {
          await navigator.clipboard.writeText(text);
          copyButton.textContent = 'Copied';
          setTimeout(() => {
            copyButton.textContent = 'Copy All';
          }, 1200);
        } catch {
          textArea.select();
          document.execCommand('copy');
          copyButton.textContent = 'Copied';
          setTimeout(() => {
            copyButton.textContent = 'Copy All';
          }, 1200);
        }
      });

      if (newButton) {
        newButton.addEventListener('click', () => {
          host.remove();
          startSelectionMode();
        });
      }

      if (header) {
        enablePanelDrag(host, header);
      }

      enablePanelResize(host, shadow);
    }

    if (position.youtube) {
      host.style.top = '24px';
      host.style.right = '24px';
      host.style.left = 'auto';
      host.style.width = host.style.width || '360px';
      host.style.height = host.style.height || '280px';
    } else if (typeof position.x === 'number' && typeof position.y === 'number') {
      const panelWidth = host.offsetWidth || 360;
      const panelHeight = host.offsetHeight || 280;
      const left = Math.min(Math.max(12, position.x), window.innerWidth - panelWidth - 12);
      const top = Math.min(Math.max(12, position.y), window.innerHeight - panelHeight - 12);
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
      host.style.right = 'auto';
    }

    const shadow = host.shadowRoot;

    return {
      setLoading(isLoading, message) {
        const status = shadow.getElementById('textlens-status');
        const spinner = shadow.getElementById('textlens-spinner');
        const output = shadow.getElementById('textlens-output');
        status.textContent = message || '';
        spinner.style.display = isLoading ? 'inline-block' : 'none';
        output.value = isLoading ? '' : output.value;
      },
      setText(text) {
        const status = shadow.getElementById('textlens-status');
        const spinner = shadow.getElementById('textlens-spinner');
        const output = shadow.getElementById('textlens-output');
        spinner.style.display = 'none';
        status.textContent = '';
        output.value = text;
      },
      setStatus(text) {
        const status = shadow.getElementById('textlens-status');
        const spinner = shadow.getElementById('textlens-spinner');
        const output = shadow.getElementById('textlens-output');
        spinner.style.display = 'none';
        status.textContent = text;
        output.value = '';
      }
    };
  }

  function buildPanelMarkup() {
    return `
      <div class="textlens-panel">
        <div class="textlens-panel-header">
          <span>Textract OCR</span>
          <button id="textlens-close" class="textlens-btn textlens-btn-ghost">Close</button>
        </div>
        <div class="textlens-status-row">
          <span id="textlens-spinner" class="textlens-spinner" style="display:none"></span>
          <span id="textlens-status"></span>
        </div>
        <textarea id="textlens-output" class="textlens-output" placeholder="Extracted text appears here..."></textarea>
        <div class="textlens-actions">
          <button id="textlens-new" class="textlens-btn textlens-btn-secondary">New</button>
          <button id="textlens-copy" class="textlens-btn">Copy All</button>
        </div>
        <div class="textlens-resize-handle textlens-resize-n" data-dir="n"></div>
        <div class="textlens-resize-handle textlens-resize-e" data-dir="e"></div>
        <div class="textlens-resize-handle textlens-resize-s" data-dir="s"></div>
        <div class="textlens-resize-handle textlens-resize-w" data-dir="w"></div>
        <div class="textlens-resize-handle textlens-resize-ne" data-dir="ne"></div>
        <div class="textlens-resize-handle textlens-resize-nw" data-dir="nw"></div>
        <div class="textlens-resize-handle textlens-resize-se" data-dir="se"></div>
        <div class="textlens-resize-handle textlens-resize-sw" data-dir="sw"></div>
      </div>
    `;
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Unable to load captured image'));
      image.src = dataUrl;
    });
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

  function enablePanelDrag(host, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return;
      }
      if (event.target && event.target.closest && event.target.closest('button')) {
        return;
      }
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;

      const rect = host.getBoundingClientRect();
      host.style.left = `${rect.left}px`;
      host.style.top = `${rect.top}px`;
      host.style.right = 'auto';
      originLeft = rect.left;
      originTop = rect.top;

      event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
      if (!dragging) {
        return;
      }

      const panelWidth = host.offsetWidth || 360;
      const panelHeight = host.offsetHeight || 270;
      const nextLeft = originLeft + (event.clientX - startX);
      const nextTop = originTop + (event.clientY - startY);
      const clampedLeft = Math.min(Math.max(12, nextLeft), window.innerWidth - panelWidth - 12);
      const clampedTop = Math.min(Math.max(12, nextTop), window.innerHeight - panelHeight - 12);

      host.style.left = `${clampedLeft}px`;
      host.style.top = `${clampedTop}px`;
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  function enablePanelResize(host, shadow) {
    const handles = shadow.querySelectorAll('.textlens-resize-handle');
    if (!handles.length) {
      return;
    }

    const minWidth = 300;
    const minHeight = 220;
    let resizing = false;
    let dir = '';
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let startWidth = 0;
    let startHeight = 0;

    handles.forEach((handle) => {
      handle.addEventListener('mousedown', (event) => {
        if (event.button !== 0) {
          return;
        }

        const rect = host.getBoundingClientRect();
        host.style.left = `${rect.left}px`;
        host.style.top = `${rect.top}px`;
        host.style.right = 'auto';
        host.style.width = `${rect.width}px`;
        host.style.height = `${rect.height}px`;

        resizing = true;
        dir = handle.getAttribute('data-dir') || '';
        startX = event.clientX;
        startY = event.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        startWidth = rect.width;
        startHeight = rect.height;
        event.preventDefault();
      });
    });

    window.addEventListener('mousemove', (event) => {
      if (!resizing || !dir) {
        return;
      }

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      let nextLeft = startLeft;
      let nextTop = startTop;
      let nextWidth = startWidth;
      let nextHeight = startHeight;

      if (dir.includes('e')) {
        nextWidth = startWidth + dx;
      }
      if (dir.includes('s')) {
        nextHeight = startHeight + dy;
      }
      if (dir.includes('w')) {
        nextWidth = startWidth - dx;
        nextLeft = startLeft + dx;
      }
      if (dir.includes('n')) {
        nextHeight = startHeight - dy;
        nextTop = startTop + dy;
      }

      if (nextWidth < minWidth) {
        if (dir.includes('w')) {
          nextLeft -= minWidth - nextWidth;
        }
        nextWidth = minWidth;
      }

      if (nextHeight < minHeight) {
        if (dir.includes('n')) {
          nextTop -= minHeight - nextHeight;
        }
        nextHeight = minHeight;
      }

      const maxLeft = Math.max(12, window.innerWidth - nextWidth - 12);
      const maxTop = Math.max(12, window.innerHeight - nextHeight - 12);
      nextLeft = Math.min(Math.max(12, nextLeft), maxLeft);
      nextTop = Math.min(Math.max(12, nextTop), maxTop);

      host.style.left = `${nextLeft}px`;
      host.style.top = `${nextTop}px`;
      host.style.width = `${nextWidth}px`;
      host.style.height = `${nextHeight}px`;
    });

    window.addEventListener('mouseup', () => {
      resizing = false;
      dir = '';
    });
  }
})();
