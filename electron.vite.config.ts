import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite uses esbuild to bundle this config, injecting __dirname.
// Using path-constructor to handle cross-platform paths.
const SRC = 'src/renderer'
const MAIN_HTML = `${SRC}/main-window/index.html`
const OVERLAY_HTML = `${SRC}/overlay-window/index.html`
const SELECTOR_HTML = `${SRC}/selector-window/index.html`

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
    // Default entry: src/main/index.ts
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
    // Default entry: src/preload/index.ts
  },
  renderer: {
    root: SRC,
    build: {
      rollupOptions: {
        input: {
          main: MAIN_HTML,
          overlay: OVERLAY_HTML,
          selector: SELECTOR_HTML
        }
      }
    },
    plugins: [react()]
  }
})
