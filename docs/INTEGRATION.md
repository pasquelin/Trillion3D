# Web / Electron / Node Integration

- **Web**: `createWorld(canvasOrId)` owns the scene, the camera, the renderer and the loop; `await world.scene.load(manifestUrl)` adds a compiled model to it, like anything else added to the scene. The application owns canvas layout and disposal. With `interactive: false`, the host owns frame scheduling (`world.render()`). See [Create a world](SDK.md#create-a-world).
- **Electron**: `prepare` in main process, `createWorld` in renderer process. No Electron imports in the SDK.
- **Node**: `prepare` / `createCompilationJob` / CLI `web-geometry-compile`.
- **Other Languages**: consumption via cache format (JSON pointer + `clusters.json` + SHA-256 objects + `source.gltf`). Interface is the versioned manifest.

The scene graph a page writes into is `world.scene` — `Object3D`-based, `scene.add(object, …)` —
described in [Create a world](SDK.md#create-a-world) and the [families](SDK.md#families) it builds
with. The DOM-free `sdk-core` transform foundation it is built on is versioned independently as
`SCENE_MODEL_VERSION` 1; `SceneRoot` and `createSceneRoot` are exported by the common facade
`web-geometry`, but are not members of the `world` object itself. No Three.js adapter ships or is planned: a host that already writes
Three.js code writes the same shapes with this engine's families instead (portal guide, "Migration
from Three.js") — Three.js stays a comparison witness, named only through the measurement entry
point, never mixed with a published world (issue #79).

Inside the frame, world matrices are already the engine's own. The host subtree is mirrored once
into an engine transform tree; a pass enters only the pose numbers the host moved, so the world
products are restricted to the subtrees that moved, and the pose every page record, cluster root
and transparent copy carries is a view on that tree's world buffer. A host still writes
`node.position.x` as before and still reads nothing of the engine's storage — but no host matrix
is created, copied or composed for a drawn node any more.

What draws is `createWorld`'s `renderer` option: absent, the engine takes the best path the
machine grants; forced and missing, it is refused by name, never silently served the other. One
line: [SDK.md, "What draws"](SDK.md#what-draws-the-renderer-option).
