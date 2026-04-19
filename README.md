# Textract Chrome Extension

Textract is a Manifest V3 Chrome extension that performs local OCR using bundled Tesseract.js v4 assets. It reads text from webpage images, YouTube video frames, and user-selected screen regions.

## 1) Load the extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select the folder: `textlens-extension`.
5. Pin **Textract** from the extensions toolbar if needed.

## 2) How to use each feature

### A. Click-to-OCR on images

1. Right-click any image on a page.
2. Click **Copy text from image**.
3. Textract opens a dark floating panel near the click point.
4. Review extracted text and click **Copy All**.

### B. YouTube frame OCR

1. Open a YouTube video page (`/watch` or `/shorts`).
2. Click the floating **OCR Frame** button.
3. Textract captures the current frame and runs OCR locally.
4. Extracted text appears in the panel at top-right.

### C. Selection box OCR

1. Trigger selection mode from either:
   - Extension popup: **Start Selection**
   - Keyboard shortcut: `Ctrl+Shift+X`
2. Drag to draw a region on the page.
3. OCR runs on only that selected region.
4. Results appear in a floating panel near the selection.
5. If the capture area was wrong, click **New** in the result panel to instantly retake selection.

## 3) Known limitations

- OCR accuracy decreases on low-resolution, blurry, or highly compressed images/video frames.
- Very stylized fonts, rotated text, and heavy overlays may reduce detection quality.
- OCR is configured for English text recognition by default.
- Capturing protected video content can fail depending on browser/DRM behavior.
- On extremely long pages or unusual zoom/device-scale setups, selection crop alignment can vary slightly.

## Privacy

All OCR processing happens locally in the extension. No image/frame data is sent to external servers.

## Troubleshooting

- If OCR fails on sites with strict CSP (for example YouTube), reload the extension once after updates so the offscreen OCR document permission is applied.
