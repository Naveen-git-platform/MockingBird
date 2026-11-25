# MockingBird

An AI interview practice trainer for the desktop. Practice coding, system design, SQL and behavioral
questions by voice, text or screenshot, and get hints first, then full feedback.

> Status: early development. Features land one branch at a time (see the roadmap).

## Roadmap

| Branch | Feature |
|---|---|
| `feat/app-core` | Electron shell, config, logging |
| `feat/llm-providers` | Gemini, OpenAI, Anthropic and Ollama |
| `feat/interview-modes` | DSA, system design, behavioral, SQL, hint-first answers |
| `feat/input-capture` | Screen, window and area capture, pasted images, typed questions |
| `feat/voice-input` | Local Whisper speech-to-text, optional system audio |
| `feat/mock-interview` | Interviewer, scoring and feedback loop |
| `feat/history-progress` | Saved sessions, markdown export, progress stats |
| `feat/ui-refresh` | New interface and onboarding |
| `feat/security-release` | Encrypted API keys, installers |

## Development

```bash
npm test
```

## Credits

MockingBird started from ideas and code in [OpenCluely](https://github.com/TechyCSR/OpenCluely) by
TechyCSR (Apache-2.0). See [NOTICE](NOTICE).

## License

Apache License 2.0. See [LICENSE](LICENSE).
