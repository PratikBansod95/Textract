const startBtn = document.getElementById('start-selection');
const statusEl = document.getElementById('status');

startBtn.addEventListener('click', async () => {
  statusEl.textContent = '';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'TEXTLENS_TRIGGER_SELECTION' });
    if (!response?.ok) {
      statusEl.textContent = response?.error || 'Could not start selection on this page.';
      return;
    }

    window.close();
  } catch (error) {
    statusEl.textContent = error?.message || 'Could not start selection on this page.';
  }
});