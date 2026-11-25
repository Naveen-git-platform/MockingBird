const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseImageDataUrl, clampRect, scaleRect, isValidRect, base64Bytes, MAX_IMAGE_BYTES,
} = require('../src/main/capture/image-utils');
const { CaptureService } = require('../src/main/capture/capture-service');
const { normalizeInput, MAX_IMAGES, MAX_TEXT_CHARS } = require('../src/main/capture/input');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function fakeImage({ width = 200, height = 100, empty = false, tag = 'img' } = {}) {
  return {
    tag,
    isEmpty: () => empty,
    getSize: () => ({ width, height }),
    toPNG: () => Buffer.from(`png:${tag}:${width}x${height}`),
    toDataURL: () => `data:image/png;base64,${Buffer.from(tag).toString('base64')}`,
    crop(rect) {
      return fakeImage({ width: rect.width, height: rect.height, tag: `${tag}-crop(${rect.x},${rect.y})` });
    },
  };
}

function fakeElectron({ sources, displays } = {}) {
  const calls = [];
  const defaultDisplays = [{ id: 1, scaleFactor: 2, size: { width: 100, height: 50 } }, { id: 2, scaleFactor: 1, size: { width: 80, height: 40 } }];
  const list = displays || defaultDisplays;
  return {
    calls,
    desktopCapturer: {
      getSources: async (opts) => {
        calls.push(opts);
        return sources || [
          { id: 'screen:1:0', name: 'Screen 1', display_id: '1', thumbnail: fakeImage({ tag: 's1' }) },
          { id: 'screen:2:0', name: 'Screen 2', display_id: '2', thumbnail: fakeImage({ tag: 's2' }) },
          { id: 'window:9:0', name: 'Editor', display_id: '', thumbnail: fakeImage({ tag: 'w9' }) },
        ];
      },
    },
    screen: { getAllDisplays: () => list, getPrimaryDisplay: () => list[0] },
  };
}

test('parseImageDataUrl returns a provider-neutral image part', () => {
  assert.deepEqual(parseImageDataUrl(PNG), { mimeType: 'image/png', data: 'iVBORw0KGgo=' });
});

test('parseImageDataUrl rejects bad input', () => {
  assert.throws(() => parseImageDataUrl(42), /data URL string/);
  assert.throws(() => parseImageDataUrl('hello'), /base64 data URL/);
  assert.throws(() => parseImageDataUrl('data:image/gif;base64,AAAA'), /Unsupported image type/);
  assert.throws(() => parseImageDataUrl('data:text/html;base64,AAAA'), /Unsupported image type/);
});

test('parseImageDataUrl enforces the size limit', () => {
  const big = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8);
  assert.throws(() => parseImageDataUrl(`data:image/png;base64,${big}`), /larger than 8 MB/);
  assert.doesNotThrow(() => parseImageDataUrl(PNG, { maxBytes: 100 }));
  assert.throws(() => parseImageDataUrl(PNG, { maxBytes: 3 }), /larger than/);
});

test('base64Bytes accounts for padding', () => {
  assert.equal(base64Bytes('QUJD'), 3);
  assert.equal(base64Bytes('QUI='), 2);
  assert.equal(base64Bytes('QQ=='), 1);
});

test('isValidRect, clampRect and scaleRect', () => {
  assert.equal(isValidRect({ x: 0, y: 0, width: 1, height: 1 }), true);
  assert.equal(isValidRect({ x: 0, y: 0, width: 0, height: 1 }), false);
  assert.equal(isValidRect({ x: NaN, y: 0, width: 1, height: 1 }), false);
  assert.equal(isValidRect(null), false);
  const size = { width: 100, height: 50 };
  assert.deepEqual(clampRect({ x: -10, y: -5, width: 30, height: 20 }, size), { x: 0, y: 0, width: 20, height: 15 });
  assert.deepEqual(clampRect({ x: 90, y: 40, width: 50, height: 50 }, size), { x: 90, y: 40, width: 10, height: 10 });
  assert.equal(clampRect({ x: 200, y: 0, width: 10, height: 10 }, size), null);
  assert.deepEqual(scaleRect({ x: 10, y: 5, width: 20, height: 10 }, { width: 50, height: 25 }, { width: 100, height: 50 }), { x: 20, y: 10, width: 40, height: 20 });
});

test('listSources returns screens and windows with previews', async () => {
  const el = fakeElectron();
  const svc = new CaptureService(el);
  const list = await svc.listSources();
  assert.deepEqual(list.map((s) => [s.id, s.kind]), [['screen:1:0', 'screen'], ['screen:2:0', 'screen'], ['window:9:0', 'window']]);
  assert.match(list[0].preview, /^data:image\/png;base64,/);
  assert.deepEqual(el.calls[0].types, ['screen', 'window']);
});

test('listSources hides sources with empty thumbnails', async () => {
  const el = fakeElectron({ sources: [{ id: 'window:1:0', name: 'x', thumbnail: fakeImage({ empty: true }) }] });
  assert.deepEqual(await new CaptureService(el).listSources(), []);
});

test('captureScreen picks the matching display and requests native resolution', async () => {
  const el = fakeElectron();
  const out = await new CaptureService(el).captureScreen({ displayId: 2 });
  assert.equal(out.mimeType, 'image/png');
  assert.match(Buffer.from(out.data, 'base64').toString(), /^png:s2:/);
  assert.deepEqual(el.calls[0].thumbnailSize, { width: 80, height: 40 });
  const primary = fakeElectron();
  await new CaptureService(primary).captureScreen();
  assert.deepEqual(primary.calls[0].thumbnailSize, { width: 200, height: 100 });
});

test('captureScreen errors when nothing can be captured', async () => {
  const none = fakeElectron({ sources: [] });
  await assert.rejects(new CaptureService(none).captureScreen(), /No screen sources/);
  const empty = fakeElectron({ sources: [{ id: 'screen:1:0', display_id: '1', thumbnail: fakeImage({ empty: true }) }] });
  await assert.rejects(new CaptureService(empty).captureScreen(), /empty image/);
});

test('captureSource captures a chosen window and rejects unknown ids', async () => {
  const svc = new CaptureService(fakeElectron());
  const out = await svc.captureSource('window:9:0');
  assert.match(Buffer.from(out.data, 'base64').toString(), /^png:w9:/);
  await assert.rejects(svc.captureSource('window:404:0'), /no longer available/);
  assert.throws(() => svc.captureSource(''), /sourceId is required/);
});

test('captureArea scales the dragged rectangle into image pixels before cropping', async () => {
  const svc = new CaptureService(fakeElectron());
  const out = await svc.captureArea('screen:1:0', { x: 10, y: 5, width: 50, height: 25 }, { width: 100, height: 50 });
  const text = Buffer.from(out.data, 'base64').toString();
  assert.equal(text, 'png:s1-crop(20,10):100x50');
});

test('captureArea validates its arguments and the selection', async () => {
  const svc = new CaptureService(fakeElectron());
  assert.throws(() => svc.captureArea('screen:1:0', {}, null), /viewport size/);
  await assert.rejects(svc.captureArea('screen:1:0', { x: 500, y: 0, width: 10, height: 10 }, { width: 100, height: 50 }), /empty or outside/);
  await assert.rejects(svc.captureArea('screen:1:0', { x: 0, y: 0, width: 0, height: 0 }, { width: 100, height: 50 }), /empty or outside/);
});

test('only one capture runs at a time and the lock is released after errors', async () => {
  const svc = new CaptureService(fakeElectron());
  const first = svc.captureScreen();
  await assert.rejects(svc.captureScreen(), /already in progress/);
  await first;
  await assert.rejects(svc.captureSource('window:404:0'), /no longer available/);
  await assert.doesNotReject(svc.captureScreen());
});

test('readClipboardImage returns an image or null', () => {
  const el = fakeElectron();
  assert.equal(new CaptureService(el).readClipboardImage(), null);
  assert.equal(new CaptureService({ ...el, clipboard: { readImage: () => fakeImage({ empty: true }) } }).readClipboardImage(), null);
  const got = new CaptureService({ ...el, clipboard: { readImage: () => fakeImage({ tag: 'clip' }) } }).readClipboardImage();
  assert.equal(got.mimeType, 'image/png');
});

test('normalizeInput accepts text, data URLs and image parts', () => {
  assert.deepEqual(normalizeInput({ text: '  hi ' }), { text: 'hi', images: [] });
  const out = normalizeInput({ text: 'q', images: [PNG, { mimeType: 'image/jpeg', data: 'QUJD' }] });
  assert.deepEqual(out.images.map((i) => i.mimeType), ['image/png', 'image/jpeg']);
  assert.equal(normalizeInput({ images: [PNG] }).text, '');
});

test('normalizeInput rejects empty, oversized and malformed input', () => {
  assert.throws(() => normalizeInput(null), /must be an object/);
  assert.throws(() => normalizeInput({ text: '   ' }), /Type a question/);
  assert.throws(() => normalizeInput({ text: 'x'.repeat(MAX_TEXT_CHARS + 1) }), /longer than/);
  assert.throws(() => normalizeInput({ images: Array(MAX_IMAGES + 1).fill(PNG) }), /At most/);
  assert.throws(() => normalizeInput({ images: ['nope'] }), /base64 data URL/);
});
