# Web / Electron / Node Integration

- **Web**: `createWorld(canvasOrId)` owns the scene, the camera, the renderer and the loop;
  `await world.scene.load(manifestUrl)` adds a compiled model to it like anything else. The
  application owns canvas layout and disposal. With `interactive: false`, the host owns frame
  scheduling (`world.render()`). See [Create a world](SDK.md#create-a-world).
- **Electron**: `prepare` in the main process, `createWorld` in the renderer process. No Electron
  import in the SDK ([hosts](../packages/README.md#hosts)).
- **Node**: `prepare`, `prepareMany`, `createCompilationJob`, or the `web-geometry-compile` CLI
  ([COMPILER.md](COMPILER.md#using-it-from-node)).
- **Other languages**: spawn `web-geometry-compiler` and read the cache — JSON pointer,
  `clusters.json` and its sidecar, SHA-256 objects, `source.gltf` ([FORMAT.md](FORMAT.md)). The
  interface is the versioned manifest.

What draws is `createWorld`'s `renderer` option: absent, the engine takes the best path the machine
grants; forced and missing, it is refused by name, never silently served the other
([SDK.md, "What draws"](SDK.md#what-draws-the-renderer-option)).

## Migration from Three.js

No Three.js adapter ships or is planned: a host that already writes Three.js code writes the same
shapes with this engine's [families](SDK.md#families) instead (portal guide, "Migration from
Three.js"; the witness call column of [API.md](API.md#measured-against-the-witness-library)).
Three.js stays a comparison witness of the bench, never mixed with a published world (#79).
