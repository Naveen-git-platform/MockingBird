// AudioWorklet: forwards mono Float32 blocks from the audio thread to the page.
class PcmForwarder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('pcm-forwarder', PcmForwarder);
