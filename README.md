# Realtime Audio Studio

Realtime Audio Studio is a static Vue 3 + TypeScript + Vite PWA for testing Azure realtime audio conversations with full session-parameter control, event logging, and stub-only tool calls.

> [!IMPORTANT]
> **Privacy & Security:** endpoint URLs, deployment names, and API keys are held in memory only for the current browser session. They are never stored, logged, or sent anywhere except directly to the Azure endpoint you choose. Browser WebSockets authenticate with an `api-key` query parameter because browsers cannot set custom WebSocket headers; the key is redacted everywhere in the on-screen event log.

## Features

- Captures PCM16 microphone audio at 24 kHz or transcodes it in an AudioWorklet to
  G.711 mu-law / A-law at 8 kHz for telephony accuracy testing.
- Plays model audio responses through a user-selectable speaker.
- Supports Azure AI Foundry and Azure OpenAI realtime audio endpoints.
- Includes GitHub Models as a REST-inference-only provider with realtime UX gated/disabled.
- Exposes realtime session parameters by model capability profile.
- Logs every normalized socket event and tool-call event.
- Supports user-defined **stub-only** tools for function-call flow testing.
- Runs as a static SPA PWA with no backend and no router.
- Stores only non-secret preferences, such as provider, model preset, theme, session parameters, tool definitions, and selected devices, in `localStorage`.

## Supported providers and models

| Provider | Realtime audio | REST inference | Notes |
| --- | --- | --- | --- |
| Azure AI Foundry | Yes | No | Full realtime WebSocket audio using the selected endpoint, deployment, and API key. |
| Azure OpenAI | Yes | No | Full realtime WebSocket audio using Azure OpenAI realtime deployments. |
| GitHub Models | No | Yes | REST inference only. Realtime controls are disabled with clear UX. |

| Model preset | Deployment/model id | Schema family | Notes |
| --- | --- | --- | --- |
| GPT-realtime 1 | `gpt-realtime` | GA nested session schema | General-availability realtime model with audio output. |
| GPT-realtime 1.5 | `gpt-realtime-1.5` | GA nested session schema | General-availability realtime model with audio output. |
| GPT-realtime 2 | `gpt-realtime-2` | GA nested session schema | Preview model with one selectable audio or text output modality. |
| GPT-realtime mini | `gpt-realtime-mini` | GA nested session schema | Smaller realtime preset. |
| GPT-4o realtime preview | `gpt-4o-realtime-preview` | Legacy flat session schema | Legacy preview compatibility path. |

No image generation is included.

## Quick start

```powershell
npm install
npm run dev
```

Open the local Vite URL, then use the app from a secure context (`localhost` is allowed for development).

## Usage walkthrough

1. Enter the resource endpoint or paste the full portal realtime URI, then provide the API key. A `model` query parameter selects the matching model and deployment automatically.
2. Pick the provider and model preset.
3. Configure realtime session parameters for that model.
4. Allow microphone access when the browser prompts.
5. Pick an input microphone and, in supported browsers, an output speaker.
6. Connect and start talking.
7. Adjust session parameters as needed; connected sessions receive changes automatically.
8. Watch the event log for socket events, audio events, session updates, and tool-call messages.
9. Define stub tools to test model function-call behavior. Stub tools never execute real code and never call external MCP servers.

## Configuration and parameters

The UI renders parameters based on each model preset's capability profile. Depending on model support, parameters include:

- Turn detection modes and thresholds.
- Input transcription models.
- Microphone input format (PCM16, G.711 mu-law, or G.711 A-law).
- Voices.
- Temperature for legacy preview models (GA models use service-managed temperature).
- Input noise reduction.
- Response speed.
- Output modalities.
- Maximum response tokens.
- Tool definitions for stub-only function-call testing.

GA realtime models use a nested session schema. Legacy realtime preview models use a flat session schema.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Run `vue-tsc --build` and produce the Vite production build. |
| `npm run preview` | Preview the production build locally. |
| `npm run type-check` | Run Vue/TypeScript type checking. |
| `npm run lint` | Run ESLint with zero warnings allowed. |
| `npm run lint:fix` | Run ESLint fixes where possible. |
| `npm run format` | Format the repository with Prettier. |
| `npm run format:check` | Check repository formatting with Prettier. |
| `npm run test` | Run Vitest once. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run test:coverage` | Run Vitest with coverage. |

## Deployment

### GitHub Pages

The `.github/workflows/deploy-pages.yml` workflow builds and deploys the app to GitHub Pages on pushes to `main` and on manual dispatch.

1. In repository settings, set **Pages** source to **GitHub Actions**.
2. Push to `main` or run the deploy workflow manually.
3. The workflow runs with Node 24 and `DEPLOY_TARGET=ghpages`.

When `DEPLOY_TARGET=ghpages` is set, Vite uses the GitHub Pages project-site base path `/ms-partner-realtime-demo/`. The default base path is `/` for Azure Static Web Apps and other root-hosted deployments.

### Azure Static Web Apps

The app is static and can be deployed to Azure Static Web Apps with:

- App location/root: `/`
- Build command: `npm run build`
- Output location: `dist`

`staticwebapp.config.json` provides the SPA fallback, MIME types, and security headers for Azure Static Web Apps.

## Tech stack

- Vue 3
- TypeScript
- Vite
- Pinia
- VitePWA
- Vitest
- ESLint
- Prettier

## Project structure

```text
.
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy-pages.yml
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── SECURITY.md
├── public/
│   ├── apple-touch-icon.png
│   ├── pwa-192x192.png
│   ├── pwa-512x512.png
│   ├── pwa-maskable-192x192.png
│   └── pwa-maskable-512x512.png
├── scripts/
│   └── generate-icons.mjs
├── src/
│   ├── audio/
│   ├── providers/
│   └── realtime/
├── staticwebapp.config.json
└── vite.config.ts
```

## Security model

- Secrets are held in memory only for the current session.
- Secrets are never persisted to `localStorage`.
- API keys are redacted from URLs and logs shown in the event log.
- The WebSocket connection sends the `api-key` query parameter only to the endpoint you configure, over TLS with `wss`.
- The app uses a restrictive Content Security Policy.
- Stub tools are inert definitions used to exercise realtime function-call behavior; they do not execute local code and do not call external MCP servers.
- Use least-privilege keys and rotate them regularly.

## Browser support

- `getUserMedia` requires HTTPS or `localhost`.
- Chromium-based browsers provide the best speaker-selection support through `setSinkId`.
- Browsers without `setSinkId` can still play audio through the system default output device.
- Microphone and audio-device labels may be hidden until permission is granted.

## License and attribution

License and attribution details are placeholders for the project integrator to finalize.
