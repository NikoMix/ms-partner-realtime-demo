import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/main.css'
import { useSettingsStore } from '@/stores/settings'

const app = createApp(App)
app.use(createPinia())

// Theme application: honour the persisted preference and the OS setting.
const settings = useSettingsStore()
const prefersDark =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

function applyTheme(): void {
  const preference = settings.theme
  const dark = preference === 'dark' || (preference === 'system' && (prefersDark?.matches ?? false))
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

applyTheme()
watch(() => settings.theme, applyTheme)
prefersDark?.addEventListener('change', applyTheme)

app.mount('#app')
