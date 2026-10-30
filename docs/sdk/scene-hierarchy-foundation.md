# Scene hierarchy foundation

Below `world.scene`, the common facade publishes the DOM-free transform foundation
(`SCENE_MODEL_VERSION` 1): `createSceneRoot` makes a `SceneRoot`, a tree kept outside a world.

- `root.createNode({ id, visible })` gives stable, root-unique ids.
- `add` and `reparent` keep the local pose, `attach` the world pose (a shear is lost); `remove` and
  `clear` detach, `destroy` invalidates a subtree for good.
- `clone` gives a fresh id unless one is given, `copy` keeps the destination's. Copying an ancestor into
  its descendant is rejected (`SCENE_COPY_OVERLAP`), as are duplicate ids and nodes of two roots; a
  cycle changes nothing.
- Setters mark the transform dirty: call `updateWorldMatrix()` before reading `worldMatrix`.

```javascript
import { createSceneRoot } from 'trillion3d'

const scene = createSceneRoot({ id: 'warehouse' })
const shelf = scene.createNode({ id: 'shelf' }).setPosition(2, 0, -4)
const crate = scene.createNode({ id: 'crate' }).setScale(0.5, 0.5, 0.5)
scene.add(shelf)
shelf.add(crate).updateWorldMatrix()
```

`TransformNode` (browser facade) views that node through `matrix`, `matrixWorld`, `matrixAutoUpdate`,
`matrixWorldNeedsUpdate` and `updateMatrixWorld(force)`; `Object3D` and the engine's graph extend it.
Every write through a node is heard as it is made; numbers written straight into a kept
`matrix.elements` are announced with `matrixWorldNeedsUpdate = true`, a light's colour channels written
straight with `needsUpdate = true`: a still scene reads nothing per frame. An update or walk costs its
subtree only; a dropped object frees its slot when collected. A node the session poses under a moving
parent is composed on the GPU: its `matrixWorld` is read composed once per frame, and
`updateMatrixWorld` has nothing of it to do.

The graph classes are `Object3D`, `Group`, `Mesh`, `Scene`, `Camera` and `Light` (its `kind`; a
`rectArea` for a rectangle, a `probe` with 27 coefficients in `sh`). A probe's `sh` is nine RGB triples
of the real orthonormal spherical harmonics of the radiance, in the band order constant, `y`, `z`, `x`,
`xy`, `yz`, `3z² − 1`, `xz`, `x² − y²`; the irradiance at a normal is each coefficient times its band's
cosine weight (π, 2π/3, π/4) times its harmonic. `emptyIrradiance()` makes the 27 zeros, which
`addUniformIrradiance(sh, rgb)` (the same light from every side),
`addHemisphereIrradiance(sh, sky, ground, up)` and `addIrradianceCoefficients(sh, coefficients,
scale)` add to. A light hears its colours and target only while in a world. A world hands a `hemisphere`
light the sky over a ground as the environment's irradiance. A `Scene` built with no loader refuses
`load` (`UNSUPPORTED_SCENE_UPDATE`); its `onBeforeRender` and `onAfterRender` run around each draw. A
`Camera` publishes `projectionMatrix` (the engine's own: depth reversed onto [0, 1], 1 on the near plane
and 0 at infinity for a perspective camera, at the far plane for an orthographic one) and
`matrixWorldInverse`.

`clone(recursive)` returns the same class with name, pose, matrices, flags, `userData` and, unless
`recursive` is `false`, cloned children; `copy(source, recursive)` writes the same into an existing
node. A `Light` also keeps its light values and target, a `Camera` its optics, a `Mesh` its primitive,
sharing geometry and material. Cloning a `Scene` or `LoadedModel` throws `UNSUPPORTED_SCENE_UPDATE`;
`cloneObject` is the deep copy, sharing nothing.

Attributes are a `BufferAttribute` owning its numbers or an `InterleavedBufferAttribute` viewing an
`InterleavedBuffer` (`VertexAttribute` names either); a normalised integer reads and writes as its value
over its type's largest; `needsUpdate = true` bumps `version`, and `addUpdateRange` limits the upload to
the numbers written.

A `Geometry` carries `attributes`, `morphAttributes` (`morphTargetsRelative` when targets hold
displacements), `drawRange` (`setDrawRange(start, count)`: the corners of the index drawn, or of the
vertices in order; any write of it cuts the pages again), `name`, `userData`; its bounds span every
vertex and morph shape, at the value each stands for (a normalised integer scaled back, a two-number
position at z = 0). `toNonIndexed()` gives each corner its own vertex. A geometry no mesh wears gives
back its pages and GPU memory, with no call; replacing a mesh's geometry disposes the one it replaces,
host copies included.
