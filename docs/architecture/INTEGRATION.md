# Web / Electron / Node Integration

- **Web**: `createExplorer` + host render loop. Canvas, requestAnimationFrame loop, and disposal are owned by the application.
- **Electron**: `prepare` in main process, `createExplorer` in renderer process. No Electron imports in the SDK.
- **Node**: `prepare` / `createCompilationJob` / CLI `web-geometry-compile`.
- **Other Languages**: consumption via cache format (JSON pointer + `clusters.json` + SHA-256 objects + `source.gltf`). Interface is the versioned manifest.

Fallback: `detectCapabilities('webgl')` never touches WebGPU. A missing or lost WebGPU backend falls back silently to the Three.js path without user warnings; `audience:'diagnostic'` events remain reserved for lab/developer monitoring.

