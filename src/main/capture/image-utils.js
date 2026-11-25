'use strict';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i;

/** Decoded size of a base64 string, in bytes. */
function base64Bytes(b64) {
  const clean = b64.replace(/[\r\n]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/**
 * Parse and validate an image data URL into the provider-neutral image part.
 * Throws on unsupported types, malformed input, or oversized images.
 */
function parseImageDataUrl(dataUrl, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  if (typeof dataUrl !== 'string') throw new Error('Image must be a data URL string');
  const match = DATA_URL.exec(dataUrl.trim());
  if (!match) throw new Error('Image must be a base64 data URL');
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) throw new Error(`Unsupported image type: ${mimeType}`);
  const data = match[2].replace(/[\r\n]/g, '');
  if (base64Bytes(data) > maxBytes) throw new Error(`Image is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
  return { mimeType, data };
}

/** Validate a rectangle: finite numbers, positive size. */
function isValidRect(r) {
  return Boolean(r) && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
}

/**
 * Clamp a rectangle to an image of `size` and round to integers.
 * Returns null when nothing is left inside the image.
 */
function clampRect(rect, size) {
  if (!isValidRect(rect)) return null;
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const right = Math.min(size.width, Math.round(rect.x + rect.width));
  const bottom = Math.min(size.height, Math.round(rect.y + rect.height));
  const width = right - x;
  const height = bottom - y;
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}

/** Scale a rectangle measured in one coordinate space (e.g. CSS px) into another (image px). */
function scaleRect(rect, from, to) {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy };
}

module.exports = { ALLOWED_MIME, MAX_IMAGE_BYTES, base64Bytes, parseImageDataUrl, isValidRect, clampRect, scaleRect };
