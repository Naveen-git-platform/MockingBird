/* Shared by the renderer (as a classic script) and the Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PcmConvert = api;
})(typeof self !== 'undefined' ? self : this, function () {
  /** Linear-interpolation downsample of Float32 audio. */
  function downsample(input, inputRate, outputRate) {
    if (outputRate > inputRate) throw new Error('Cannot upsample');
    if (outputRate === inputRate) return input;
    const ratio = inputRate / outputRate;
    const length = Math.floor(input.length / ratio);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const pos = i * ratio;
      const lo = Math.floor(pos);
      const hi = Math.min(lo + 1, input.length - 1);
      const frac = pos - lo;
      out[i] = input[lo] * (1 - frac) + input[hi] * frac;
    }
    return out;
  }

  /** Float32 [-1, 1] to little-endian Int16 samples. */
  function floatToInt16(input) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 32768 : s * 32767;
    }
    return out;
  }

  return { downsample, floatToInt16 };
});
