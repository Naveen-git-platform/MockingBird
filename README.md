# MockingBird

An AI interview practice trainer for the desktop. Practise coding, system design, SQL and behavioral
questions by typing, speaking or pasting a screenshot, and get coached instead of just answered:
hints first, scored feedback, and a progress record.

## Features

- **Practice chat.** Ask anything in a chosen interview type, language and help level (hints only,
  guided approach, or the full solution). Follow-up questions keep their context.
- **Mock interviews.** The AI interviewer asks questions at your difficulty, scores each answer from
  0 to 10 with strengths and improvements, gives up to three progressive hints, and writes a final report.
- **Any input.** Type, paste an image, pick any screen or window and drag to crop it, or speak.
- **Voice.** Local Whisper speech-to-text with pause detection or manual start and stop, from the
  microphone or (on Windows) system audio.
- **Floating overlay.** A small always-on-top answer window you can drag, resize and make translucent.
  It is an ordinary visible window. Choose whether answers appear in the chat, the overlay or both, and
  optionally have spoken questions answered automatically.
- **Your choice of AI.** Google Gemini, OpenAI (and compatible servers), Anthropic Claude, or local
  models through Ollama, with automatic fallback between the ones you have set up.
- **Progress.** Finished interviews are saved on your computer with averages, a trend, a practice
  streak and Markdown export.
- **Private by default.** No telemetry. API keys are encrypted with your operating system's secure
  storage. The only data that leaves your computer is the question you send to your chosen AI provider.

## Getting started

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/Naveen-git-platform/MockingBird.git
cd MockingBird
npm install
npm start
```

Open **Settings**, choose a provider and paste its API key (for example from
[Google AI Studio](https://aistudio.google.com/) for Gemini). Keys can also come from the
`GEMINI_API_KEY`, `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` environment variables. Ollama needs no key:
start it and pull a model such as `ollama pull llama3.2`.

### Voice input (optional)

Voice uses a local [Whisper](https://github.com/openai/whisper) model, so audio never leaves your computer.

```bash
pip install openai-whisper
```

The first use downloads the model (about 460 MB for `small`). Set a different Python in the
`WHISPER_PYTHON` environment variable if needed.

### Installers

Tagged releases build a Windows installer and portable `.exe`, and Linux `.AppImage` and `.deb`
packages (`npm run dist:win`, `npm run dist:linux`). They are not code signed, so Windows
SmartScreen may ask you to confirm.

## Keyboard shortcuts

These work from anywhere, even when MockingBird is in the background. Change them in **Settings**
(click a box, press the new keys); a shortcut that another app already owns shows as not active.

| Action | Default |
|---|---|
| Capture the screen and answer | `Ctrl+Shift+S` |
| Start or stop voice input | `Alt+Shift+V` |
| Show or hide the overlay | `Ctrl+Shift+O` |
| Overlay click-through on or off | `Ctrl+Shift+I` |
| Show the MockingBird window | `Ctrl+Shift+M` |

On macOS, `Ctrl` is `Cmd`.

## Development

```bash
npm test         # unit tests (Node's built-in runner)
npm run smoke    # boots the real app headlessly and checks the UI loads without errors
npm run pack     # builds an unpacked app into dist/
```

To iterate on the UI in a plain browser with a mock backend, run
`node tools/ui-preview/serve.js` and open `http://127.0.0.1:5178`.

```
src/main/        Electron main process
  llm/           provider adapters (Gemini, OpenAI, Anthropic, Ollama), retry and fallback
  modes/         interview types, answer depths, languages, prompt builder
  interview/     mock interview state machine, scoring, reports
  practice/      practice chat service
  shortcuts.js   global shortcuts, quick-ask.js capture-and-answer
  overlay.js     floating answer window, answers.js routes answers to chat and/or overlay
  capture/       screen, window and area capture, input validation
  voice/         pause detection, Whisper worker client, voice controller
  history/       saved interviews, progress stats, Markdown export
  settings/      encrypted API keys and persisted preferences
src/preload/     the sandboxed bridge between UI and main process
src/renderer/    the user interface (plain HTML, CSS and JavaScript)
scripts/         the Python Whisper worker and the Electron launcher
```

## Security notes

- The window is sandboxed with context isolation; the UI can only call an explicit allowlist of
  IPC channels, and the Content Security Policy forbids inline scripts.
- Model output is rendered with an escaping Markdown renderer (no raw HTML, only http/https/mailto links).
- Links open in your system browser; the app window cannot navigate away from its own files.
- API keys are never written in plain text, and are never sent back to the UI.

## Responsible use

MockingBird is built for practice and learning. Follow the rules of any real interview or assessment
you take.

## Credits

MockingBird started from ideas and code in [OpenCluely](https://github.com/TechyCSR/OpenCluely) by
TechyCSR (Apache-2.0): the screen-capture approach, the pause-based voice segmentation and the
persistent Whisper worker design. It has been rewritten and extended; see [NOTICE](NOTICE).

## License

Apache License 2.0. See [LICENSE](LICENSE).
