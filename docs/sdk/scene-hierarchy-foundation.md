# Scene hierarchy foundation

Below `world.scene`, the common facade publishes the DOM-free transform foundation
(`SCENE_MODEL_VERSION` 1): `createSceneRoot` makes a `SceneRoot`, a tree kept outside a world.

- `root.createNode({ id, visible })` gives root-unique ids.
- `add` and `reparent` keep the local pose, `attach` the world pose (a shear is lost); `remove` and
  `clear` detach, `destroy` invalidates a subtree.
- `clone` gives a fresh id unless one is given, `copy` keeps the destination's. Copying an ancestor
  into its descendant is rejected (`SCENE_COPY_OVERLAP`), as are duplicate ids and nodes of two roots;
  a cycle changes nothing.
- Call `updateWorldMatrix()` before reading `worldMatrix`.

```javascript
import { createSceneRoot } from 'trillion3d'

const scene = createSceneRoot({ id: 'warehouse' })
const shelf = scene.createNode({ id: 'shelf' }).setPosition(2, 0, -4)
const crate = scene.createNode({ id: 'crate' }).setScale(0.5, 0.5, 0.5)
scene.add(shelf)
shelf.add(crate).updateWorldMatrix()
```

`TransformNode` (browser facade) exposes `matrix`, `matrixWorld`, `matrixAutoUpdate`,
`matrixWorldNeedsUpdate`, `updateMatrixWorld(force)`; `Object3D` and the engine's graph extend it.
Numbers written straight into `matrix.elements` need `matrixWorldNeedsUpdate = true`, a light's colour
channels written straight need `needsUpdate = true`. A node the session poses under a moving parent is
composed on the GPU; `updateMatrixWorld` does nothing for it.

Graph classes: `Object3D`, `Group`, `Mesh`, `Scene`, `Camera`, `Light` (`kind`; `rectArea`; `probe`
with 27 coefficients in `sh`). A probe's `sh` is nine RGB triples of real orthonormal spherical
harmonics of radiance, band order constant, `y`, `z`, `x`, `xy`, `yz`, `3z² − 1`, `xz`, `x² − y²`;
irradiance is coefficient times band cosine weight (π, 2π/3, π/4) times harmonic. `emptyIrradiance()`
makes 27 zeros; `addUniformIrradiance(sh, rgb)`, `addHemisphereIrradiance(sh, sky, ground, up)` and
`addIrradianceCoefficients(sh, coefficients, scale)` add to them. A light hears its colours and target
only while in a world; a `hemisphere` light gives the environment its irradiance. A `Scene` with no loader refuses `load` (`UNSUPPORTED_SCENE_UPDATE`);
`onBeforeRender` and `onAfterRender` run around each draw. `Camera` publishes `projectionMatrix` (depth
reversed onto [0, 1]: 1 at near, 0 at infinity perspective, at far orthographic) and `matrixWorldInverse`.

`clone(recursive)` returns the same class with name, pose, matrices, flags, `userData` and, unless
`recursive` is `false`, cloned children; `copy(source, recursive)` writes into an existing node.
Geometry and material are shared. Cloning a `Scene` or `LoadedModel` throws
`UNSUPPORTED_SCENE_UPDATE`; `cloneObject` deep-copies.

Attributes: `BufferAttribute` owns its numbers, `InterleavedBufferAttribute` views an
`InterleavedBuffer` (`VertexAttribute` names either); a normalised integer reads and writes as value over its type's
largest; `needsUpdate = true` bumps `version`;
`addUpdateRange` limits the upload.

`Geometry`: `attributes`, `morphAttributes` (`morphTargetsRelative`), `drawRange`
(`setDrawRange(start, count)`: corners of the index drawn, or vertices in order; any write cuts the
pages again), `name`, `userData`; bounds span every vertex and morph shape at the value each stands
for (normalised integer scaled back, two-number position at z = 0). `toNonIndexed()` gives each corner its own vertex.
An unused geometry frees its memory; replacing a mesh's geometry disposes the old one.
