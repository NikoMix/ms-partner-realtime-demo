# Security

Realtime Audio Studio is a static browser app for testing Azure realtime audio endpoints. It has no backend, no proxy, and no server-side persistence.

## Threat model

The primary sensitive values are:

- Azure endpoint URL.
- Deployment name.
- API key.

The app assumes the browser, hosting provider, and configured Azure endpoint are trusted by the user. It does not attempt to protect secrets from a compromised browser, malicious extension, or hostile static host.

## Guarantees

- Secrets are kept in memory only for the current browser session.
- Secrets are never saved to `localStorage`.
- Secrets are never intentionally logged.
- API keys are redacted from URLs and event-log entries.
- Secrets are sent only to the user's chosen Azure realtime endpoint.
- Non-secret preferences may be saved to `localStorage`.

Non-secret preferences can include provider, model preset, theme, session parameters, tool definitions, and audio device selections.

## WebSocket API-key transport

Browser WebSockets cannot set arbitrary authentication headers. For Azure realtime browser connections, the `api-key` travels in the WebSocket URL query string to the configured endpoint.

This is unavoidable for direct browser WebSocket authentication. The connection must use TLS with `wss`, and the key is redacted everywhere the app displays URLs or event data.

## Content Security Policy

The app uses a strict CSP at build time and in `staticwebapp.config.json` for Azure Static Web Apps:

```text
default-src 'self'; connect-src 'self' https: wss:; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; font-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

The Azure Static Web Apps config also sets:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: microphone=(self)`

## Stub-only tools

User-defined tools are inert stubs. They exist to test model function-call behavior and event flow.

They do not:

- Execute local code.
- Run shell commands.
- Call external APIs.
- Call external MCP servers.
- Access files or credentials.

## Operational recommendations

- Use least-privilege API keys.
- Rotate keys regularly.
- Prefer test resources for demos.
- Avoid entering production credentials on untrusted devices.
- Host only from trusted static hosting environments.
- Review event logs before sharing screenshots, even though keys are redacted.
