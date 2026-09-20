# Web / Electron / Node Integration

- **Web**: `createExplorer(canvasOrId, { manifestUrl, scope, interactive: true })` owns controls, CSS/DPR sizing and demand-driven rendering. The application owns canvas layout and disposal. Without `interactive`, the host owns frame scheduling. See [browser startup](../SDK.md#simple-browser-startup).
- **Electron**: `prepare` in main process, `createExplorer` in renderer process. No Electron imports in the SDK.
- **Node**: `prepare` / `createCompilationJob` / CLI `web-geometry-compile`.
- **Other Languages**: consumption via cache format (JSON pointer + `clusters.json` + SHA-256 objects + `source.gltf`). Interface is the versioned manifest.

The DOM-free `sdk-core` scene hierarchy is versioned independently as `SCENE_MODEL_VERSION` 1.
Hosts may already build `SceneRoot` / `SceneNode` trees with stable ids, visibility and local
transforms. Browser rendering still receives its current prepared-scene contract in this batch;
passing a `SceneRoot` to `createExplorer` starts only when the later #78 contract-migration lot
lands. A Three.js adapter therefore targets this public hierarchy rather than introducing another
scene model, but cannot complete material or frame-hook conversion yet.

Manual mixed-backend fallback: `detectCapabilities('webgl')` never touches WebGPU. A missing or lost WebGPU backend falls back silently to the Three.js path without user warnings; `audience:'diagnostic'` events remain reserved for lab/developer monitoring.

Interactive startup defaults to direct WebGPU and rejects `WEBGPU_UNAVAILABLE` when unavailable. Choose an explicit backend to select a different capability set. Use canvas elements for framework refs and shadow roots; a string is a literal document ID, not a selector.
