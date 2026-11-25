/* Renderer-side audio capture. Streams 16 kHz mono PCM16 frames to the main process.
 * source 'mic'    - the microphone (getUserMedia)
 * source 'system' - what the computer is playing (Windows loopback via getDisplayMedia)
 * Not unit tested (needs real audio hardware); the conversion maths is in pcm-convert.js. */
(function () {
  const TARGET_RATE = 16000;
  let session = null;

  async function getStream(source) {
    if (source === 'system') {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      stream.getVideoTracks().forEach((t) => t.stop());
      if (stream.getAudioTracks().length === 0) throw new Error('System audio is not available on this platform');
      return stream;
    }
    return navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  }

  async function start(source = 'mic') {
    if (session) throw new Error('Audio capture already running');
    const stream = await getStream(source);
    const context = new AudioContext();
    await context.audioWorklet.addModule('pcm-worklet.js');
    const node = new AudioWorkletNode(context, 'pcm-forwarder');
    context.createMediaStreamSource(stream).connect(node);
    node.port.onmessage = (event) => {
      const down = PcmConvert.downsample(event.data, context.sampleRate, TARGET_RATE);
      const pcm = PcmConvert.floatToInt16(down);
      window.mockingbird.send('voice:frame', pcm.buffer);
    };
    session = { stream, context, node };
  }

  async function stop() {
    if (!session) return;
    const { stream, context, node } = session;
    session = null;
    node.port.onmessage = null;
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await context.close();
  }

  window.AudioCapture = { start, stop, isRunning: () => Boolean(session) };
})();
