/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { App } from "./App"
import "./index.css"

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
    console.warn("[opencode-bots] service worker registration failed", error)
  })
}

const elem = document.getElementById("root")!
const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

// Keep one root across hot reloads in development; the production bundle has
// no import.meta.hot.
// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
if (import.meta.hot) {
  const data = import.meta.hot.data as { root?: Root }
  ;(data.root ??= createRoot(elem)).render(app)
} else {
  createRoot(elem).render(app)
}
