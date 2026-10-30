# Terms

- **World** — what `createWorld` returns. It owns the scene, the camera, the renderer and the loop;
  nothing else is constructed.
- **Scene** — `world.scene`, the root objects are added to; a **model**, a compiled manifest, is
  loaded into it with `scene.load(manifestUrl)` like any other addition.
- **Renderer** — the WebGPU drawing path of a world. A host never imports, names or holds one.
- **Host** — the page that creates a world: it owns the canvas, the layout and the disposal.
- **Pose** — a camera framing: `{ position, target, fov? }`.
- **Witness** — a comparison library of the bench, named only through the measurement entry point;
  it never reaches a published world.

`explorer` and `backend` are not public vocabulary.
