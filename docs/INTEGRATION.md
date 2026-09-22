# Web / Electron / Node Integration

- **Web**: `createExplorer(canvasOrId, { manifestUrl, scope, interactive: true })` owns controls, CSS/DPR sizing and demand-driven rendering. The application owns canvas layout and disposal. Without `interactive`, the host owns frame scheduling. See [browser startup](SDK.md#simple-browser-startup).
- **Electron**: `prepare` in main process, `createExplorer` in renderer process. No Electron imports in the SDK.
- **Node**: `prepare` / `createCompilationJob` / CLI `web-geometry-compile`.
- **Other Languages**: consumption via cache format (JSON pointer + `clusters.json` + SHA-256 objects + `source.gltf`). Interface is the versioned manifest.

The DOM-free `sdk-core` scene hierarchy is versioned independently as `SCENE_MODEL_VERSION` 1.
Hosts may already build `SceneRoot` / `SceneNode` trees with stable ids, visibility and local
transforms. Browser rendering still receives its current prepared-scene contract in this batch;
passing a `SceneRoot` to `createExplorer` starts only when the later #78 contract-migration lot
lands. A Three.js adapter therefore targets this public hierarchy rather than introducing another
scene model, but cannot complete material or frame-hook conversion yet.

Inside the frame, world matrices are already the engine's own. The host subtree is mirrored once
into an engine transform tree; a pass enters only the pose numbers the host moved, so the world
products are restricted to the subtrees that moved, and the pose every page record, cluster root
and transparent copy carries is a view on that tree's world buffer. A host still writes
`node.position.x` as before and still reads nothing of the engine's storage — but no host matrix
is created, copied or composed for a drawn node any more.

Manual mixed-backend fallback: `detectCapabilities('webgl')` never touches WebGPU. A session started with no `backends` option draws wherever an image can be drawn at all, and the degradation is never silent — the `backend-choice` diagnostic reports the `renderer` that draws, whether the mode is `degraded`, and the `reason`; `audience:'diagnostic'` events remain reserved for lab/developer monitoring.

| Machine                    | Backend that renders  | Scene file read | Degraded |
| -------------------------- | --------------------- | --------------- | -------- |
| A WebGPU device was granted | `webgpu-page-raster`  | `source.gltf`   | no       |
| WebGL2 only                 | `exact-cluster-pages`, a host-library witness | `source.gltf` | **yes** |
| Neither WebGPU nor WebGL2   | none — `EngineError('NO_ENGINE_BACKEND')`, and `EngineError('NO_WEBGL2')` from the capability probe before it | — | — |

The middle row is temporary: the engine's own WebGL2 path stops with `AUTONOMOUS_COVERAGE_MISSING` today, so a machine without WebGPU is served by a witness rather than an empty canvas, and #297 removes that fallback when it finishes the renderer ([SDK.md](SDK.md), "Which backend renders by default"). A host that names `backends: [webgpuPagesBackend]` explicitly is still rejected with `WEBGPU_UNAVAILABLE` when no device is granted. Choose an explicit backend to select a different capability set. Use canvas elements for framework refs and shadow roots; a string is a literal document ID, not a selector.
