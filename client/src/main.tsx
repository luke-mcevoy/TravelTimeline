import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useTripStore } from '@/stores/tripStore'
import { useGlobeStore } from '@/stores/globeStore'
import { useUiStore } from '@/stores/uiStore'

// Dev-only debug handle so demo/screenshot tooling can pose the camera and
// drive playback. Stripped from production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __TT__: unknown }).__TT__ = {
    trip: useTripStore,
    globe: useGlobeStore,
    ui: useUiStore,
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
