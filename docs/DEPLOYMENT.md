# Deployment

Realtime Audio Studio builds to a static `dist` directory and can be hosted by any static web host that supports SPA fallback routing and HTTPS.

## GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml` for GitHub Pages.

### Steps

1. Open the repository settings in GitHub.
2. Go to **Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main` or run **Deploy to GitHub Pages** manually from the Actions tab.

The workflow:

- Uses Node 24 with npm caching.
- Runs `npm ci`.
- Runs `npm run build` with `DEPLOY_TARGET=ghpages`.
- Uploads `dist`.
- Deploys with `actions/deploy-pages@v5`.

### Base path caveat

When `DEPLOY_TARGET=ghpages` is set, the Vite base path is `/ms-partner-realtime-demo/` for the GitHub Pages project-site subpath. Root-hosted deployments should use the default `/` base path by leaving `DEPLOY_TARGET` unset.

### PWA scope

On GitHub Pages project sites, the service worker and PWA assets are scoped to the project subpath. Verify that manifest URLs, icon URLs, and service-worker registration all resolve under `/ms-partner-realtime-demo/`.

## Azure Static Web Apps

Azure Static Web Apps can host the app at the root path with the included `staticwebapp.config.json`.

### Steps

1. Create a Static Web App in Azure.
2. Connect the GitHub repository or configure your preferred deployment pipeline.
3. Use a custom build preset.
4. Set app location/root to `/`.
5. Set build command to `npm run build`.
6. Set output location to `dist`.
7. Deploy.

`staticwebapp.config.json` provides:

- SPA fallback to `/index.html`.
- MIME types for `.webmanifest` and `.json`.
- Security headers, including CSP and microphone permissions policy.
- A 404 response override that serves the SPA shell with status 200.

## Troubleshooting

### Microphone access fails

`getUserMedia` requires a secure context. Use HTTPS in production or `localhost` during development.

### Speaker selection is unavailable

Speaker selection depends on `HTMLMediaElement.setSinkId`, which is best supported in Chromium-based browsers. Other browsers may play through the system default output device only.

### Realtime connection fails

Check that the endpoint, deployment name, model preset, and provider match the Azure resource you are using. Browser WebSockets authenticate with the `api-key` query parameter, so the endpoint must accept that browser-compatible form.

### CORS or endpoint errors

The app connects directly from the browser to the selected Azure endpoint. Use endpoints intended for browser access and verify that the endpoint URL, deployment route, and `api-version` are correct for the selected model. Legacy `gpt-4o-realtime-preview` deployments may require legacy-compatible `api-version` values.

### GitHub Pages shows a blank page

Confirm the deploy workflow ran with `DEPLOY_TARGET=ghpages` and that repository Pages is set to **GitHub Actions**. A wrong base path can cause JavaScript, CSS, manifest, or service-worker assets to load from `/` instead of `/ms-partner-realtime-demo/`.

### PWA assets are not detected

Confirm that icons and the web manifest are emitted under the same deployment base path. For GitHub Pages project sites, all PWA assets should resolve below `/ms-partner-realtime-demo/`.
