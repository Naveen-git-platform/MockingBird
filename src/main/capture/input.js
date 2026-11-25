'use strict';

const { parseImageDataUrl } = require('./image-utils');

const MAX_TEXT_CHARS = 20000;
const MAX_IMAGES = 4;

/**
 * Normalize whatever the renderer sends (typed text, pasted/captured images) into
 * the `input` shape used by the prompt builder: { text, images: [{mimeType, data}] }.
 * Accepts images as data URLs or already-parsed parts.
 */
function normalizeInput(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Input must be an object');
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (text.length > MAX_TEXT_CHARS) throw new Error(`Text is longer than ${MAX_TEXT_CHARS} characters`);

  const rawImages = Array.isArray(raw.images) ? raw.images : [];
  if (rawImages.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images per question`);
  const images = rawImages.map((img) =>
    typeof img === 'string' ? parseImageDataUrl(img) : parseImageDataUrl(`data:${img.mimeType};base64,${img.data}`)
  );

  if (!text && images.length === 0) throw new Error('Type a question or attach an image');
  return { text, images };
}

module.exports = { normalizeInput, MAX_TEXT_CHARS, MAX_IMAGES };
