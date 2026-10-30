# Picking, moving and saving

## Raycast

`await world.raycast(at)` resolves to the nearest hit under a canvas point (CSS pixels,
`event.offsetX`/`offsetY`) or along a world `Ray`, or `null`: the scene node drawn there, world
`point` and `normal`, `distance`, and `face`, the drawn triangle (its cluster × 256 + its rank).

- Always a promise, settled a frame or so later; rays cast in one tick trace together on the GPU.
- Hit = the finest detail the pool holds, in view or not, opaque or blended; skinned, morphed or
  waved mesh where this frame draws it.
- A line is hit where the ray passes within `lineThreshold` world units (1; 0 never hits lines),
  `normal` facing the ray; a point is hit on its dot, as wide as its material's `size`.
- Sprites, hidden objects and `helper` marks are passed by (`{ helpers: true }` meets marks).
  `{ objects }` limits the subtrees.
- Sizeless canvas refuses a point (`RAYCAST_NO_VIEW`); a world whose session is not yet open
  resolves `null`.
- `canvasRay(camera, canvas, { x, y })`: world ray through a canvas CSS-pixel point (sizeless
  canvas throws `RAYCAST_NO_VIEW`); `camera.rayThrough(x, y, aspect)`: ray through a picture point.
- Exact raycast, on physics collision shapes: [PHYSICS.md](../../PHYSICS.md#exact-raycast).
- An orthographic camera made with `fitAspect: true` takes its width from the canvas.

## Transform handles

`controls.transform(world, options)` puts move, turn, scale handles on one object: `attach(object)`,
`detach()`, `setMode('translate' | 'rotate' | 'scale')`, `setSpace('world' | 'local')`,
`snap = { translate, rotate, scale }`, events `change`, `dragStart`, `dragEnd`; one drag, one undo
step.

- Handles = unlit `helper` meshes at a share of canvas height (`size`, a quarter default).
- Hover is asked of `world.raycast`; a press takes the latest answer (a handle when the nearest hit
  is one) before the camera controller hears it. Touch: first press asks, next grabs.
- A drag writes the local pose through the parents; the centre cube scales uniformly, by e per
  handle length up the screen. `attach` or `detach` mid-drag ends it with `dragEnd`.

## Saving a scene

`scene.toJSON(camera)` writes versioned JSON (`format: 'trillion3d-scene'`, `formatVersion: 5`):
hierarchy, poses, each shape by its building call (`geometry.box(2, 1, 1)`; changed or hand-written
ones by vertices), materials by parameters, bodies as `physics` declared them (at rest), lights,
background, the sky module's word (`sky`), camera pose. Shared shapes and materials written once,
loaded models by manifest address, `helper` marks omitted. Textures, picture environments, shader
materials and numbers JSON cannot hold are refused (`SCENE_NOT_SAVABLE`).

`await scene.fromJSON(json, camera)` replaces content (`helper` marks kept) and reloads models.
Versions 2, 3, 4, 5 are read; another format or version is refused (`UNSUPPORTED_SCENE_FORMAT`)
before anything is removed. Older versions:

- 2's air, fog and sky light move into the sky module;
- rectangle light intensity saved by 2 or 3, its radiance, reads as half that many nits;
- a spot saved before 5 with `angle` and `penumbra` reads as outer cone and inner cone = angle less
  that share, a lamp naming no unit in candelas.

Calls during a read run in order, each replacing the last.
