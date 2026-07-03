import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the app from a repository sub-path. Azure Static Web Apps
// and local dev serve from the root. The Pages workflow sets DEPLOY_TARGET=ghpages.
const base = process.env.DEPLOY_TARGET === 'ghpages' ? '/ms-partner-realtime-demo/' : '/'

/**
 * Injects a strict Content-Security-Policy meta tag into the built index.html only.
 * We avoid injecting it in dev so Vite HMR (which relies on eval/inline) keeps working,
 * and we rely on this meta tag in production because GitHub Pages cannot set HTTP headers.
 *
 * `connect-src` intentionally allows arbitrary https/wss because users bring their own
 * Azure AI Foundry / Azure OpenAI / GitHub Models endpoints. No third-party origins are
 * hard-coded, and the api-key is never placed anywhere the CSP would expose.
 */
function buildTimeCsp() {
  const directives = [
    "default-src 'self'",
    "connect-src 'self' https: wss:",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "font-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')

  return {
    name: 'html-build-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      const meta = `    <meta http-equiv="Content-Security-Policy" content="${directives}" />\n  </head>`
      return html.replace('  </head>', meta)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    vue(),
    buildTimeCsp(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'robots.txt'],
      manifest: {
        name: 'Realtime Audio Studio for Azure AI Foundry',
        short_name: 'Realtime Studio',
        description:
          'Test Azure AI Foundry / Azure OpenAI realtime audio endpoints: stream your microphone, tune every model parameter, inspect all socket events, and try stub tools.',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        orientation: 'any',
        categories: ['developer', 'productivity', 'utilities'],
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
        // Only the app shell is precached; the realtime WebSocket and the api-key
        // are never intercepted or cached by the service worker.
        navigateFallbackDenylist: [/^\/api/, /realtime/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Disable the inline module-preload polyfill so a strict `script-src 'self'`
    // CSP does not need to allow inline scripts. Evergreen browsers support
    // <link rel="modulepreload"> natively.
    modulePreload: { polyfill: false },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/*.d.ts', 'src/**/*.worklet.ts'],
    },
  },
})
