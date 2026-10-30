# Picking, moving and saving

## Raycast

`await world.raycast(at)` resolves to the nearest hit under a canvas point (CSS pixels,
`event.offsetX`/`offsetY`) or along a world `Ray`, or `null`: the scene node drawn there (a mesh the
page added, or a node of a loaded model, under it), world `point` and `normal`, `distance`, and `face`,
the drawn triangle (its cluster × 256 + its rank in it).

- It always returns a promise, settled a frame or so later: the GPU traces every ray cast in the same
  tick together (down the placement tree, each placement's cluster hierarchy, then the triangles the
  rasters draw) and reads the hits back without ever stalling the page.
- What is hit is the finest detail the pool holds, in view or out of it, opaque or blended: a loaded
  model on its own triangles, a skinned, morphed or waved mesh where this frame draws it.
- A line is hit where the ray passes within `lineThreshold` world units of it (1 by default, as
  three.js's `Raycaster.params.Line.threshold`; 0 never hits a line), at the ray's nearest pass, its
  `normal` facing the ray; a point is hit on its dot, as wide as its material's `size`.
- Sprites, hidden objects and `helper` marks are passed by (`{ helpers: true }` meets the marks, as
  `controls.transform` does). `{ objects }` limits the subtrees.
- A sizeless canvas refuses a point (`RAYCAST_NO_VIEW`); a world whose drawing session is not open
  yet resolves `null`.
- `canvasRay(camera, canvas, { x, y })` is the world ray through a canvas point in CSS pixels, as
  `world.raycast` aims it: read on the canvas's CSS box, shaped as the drawing buffer is drawn (a
  sizeless canvas throws `RAYCAST_NO_VIEW`); `camera.rayThrough(x, y, aspect)` is the ray through a
  picture point.
- The exact raycast, on the physics' collision shapes, is [PHYSICS.md](../../PHYSICS.md#exact-raycast).
- An orthographic camera made with `fitAspect: true` takes its width from the canvas.

## Transform handles

`controls.transform(world, options)` puts move, turn and scale handles on one object:
`attach(object)`, `detach()`, `setMode('translate' | 'rotate' | 'scale')`,
`setSpace('world' | 'local')`, `snap = { translate, rotate, scale }`, events `change`, `dragStart`,
`dragEnd`; one drag, one undo step.

- The handles are unlit `helper` meshes at a share of the canvas height (`size`, a quarter by
  default).
- The pointer's hover is asked of `world.raycast` as it moves; a press takes the latest answer (a
  handle when the nearest hit is one, so a handle hidden by the scene is never grabbed) before the
  camera controller hears it. A touch has no hover: its first press asks, the next one grabs.
- A drag writes the local pose through the parents; the centre cube scales uniformly, by e per handle
  length up the screen. `attach` or `detach` mid-drag ends it with its `dragEnd`.

## Saving a scene

`scene.toJSON(camera)` writes plain, versioned JSON (`format: 'trillion3d-scene'`, `formatVersion:
5`): hierarchy, poses, each shape by the call that built it (`geometry.box(2, 1, 1)`; one changed
after, or hand-written, by its vertices), materials by parameters, bodies as `physics` declared them
(at rest), lights, background, the sky module's word (`sky`), the camera's pose. Shared shapes and
materials are written once, a loaded model by its manifest address, `helper` marks left out. A
texture, a picture environment, a shader material or a number JSON cannot hold is refused
(`SCENE_NOT_SAVABLE`).

`await scene.fromJSON(json, camera)` replaces the content (`helper` marks kept) and reloads the
models. Versions 2, 3, 4 and 5 are read; another format or version is refused
(`UNSUPPORTED_SCENE_FORMAT`) before anything is removed. Reading older versions:

- 2's air, fog and sky light move into the sky module;
- a rectangle light's intensity saved by 2 or 3, its radiance, is read as half that many nits;
- a spot saved before 5 with an `angle` and a `penumbra` is read as an outer cone and an inner cone of
  the angle less that share, a lamp that named no unit in candelas.

Calls during a read run in order, each replacing the last. A scene editor needs these three doors and
nothing else.
