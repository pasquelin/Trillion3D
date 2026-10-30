# World position offset and object switches

## World position offset

`g.output('worldPositionOffset', offset)` moves every vertex by `offset` (float3, world axes,
metres) in every pass that places it (visibility rasters, shading, shadow maps, translucent pass,
TAA). It sees `worldPosition()` (before the offset), `objectPosition()`,
`cameraPosition()`, `vertexNormal()`, `time()`, parameters, **one** texture coordinate set
(`texCoord(0)`) and the textures it reads. `pixelNormal()` or a second texture set: the graph is
refused once (`material-graph-refused`), the surface drawn from the material's parameters.

Moves: triangles; flat triangle corners displaced by `displacementMap` (before the patch is cut and
diced); `voxelize` bricks, rigidly by the offset at the box centre. Sprites, lines: not moved.

Texture reads in the offset use the finest level, ask no tile (fallback if non-resident), and need
ten storage buffers a stage (`maxStorageBuffersPerShaderStage`, and
`maxStorageBuffersInVertexStage` where reported), else the graph is refused once
(`material-graph-refused`) and its surface is not moved. Shadow maps split displaced patches by the
offsets that read no texture alone.

```js
import { material, Mesh } from 'trillion3d'

// A leaf that bends in the wind: the farther up its UVs, the more it sways, along a direction that turns with the position.
const g = material.graph('surface')
g.output('baseColor', g.constant(0.2, 0.6, 0.2))
const height = g.componentMask(g.texCoord(0), 'g')
const phase = g.add(g.time(), g.componentMask(g.worldPosition(), 'r'))
const sway = g.multiply(g.multiply(g.sine(phase, 2), height), g.scalarParameter('amplitude', 0.15))
g.output('worldPositionOffset', g.multiply(sway, g.constant(1, 0, 0.4)))
const leaf = material.meshStandard({ graph: g, maxWorldPositionOffset: 0.2 })
const tree = new Mesh(geometry, leaf)
tree.worldPositionOffsetDisableDistance = 80 // past 80 m from the camera the leaves stop swaying
tree.shadowCacheInvalidation = 'rigid' // its shadows are not drawn again for the sway, only when it moves
tree.mobility = 'movable' // it arrives cached in the dynamic layer of the shadow maps, as one often moving does
scene.add(tree)
```

## Object settings

Node properties, saved with the world; defaults are the reference's.

- **`evaluateWorldPositionOffset`** (boolean, `true`): `false` leaves vertices at the geometry.
- **`worldPositionOffsetDisableDistance`** (metres, `0`): past this distance from the camera to the
  centre of the object's bounds the offset stops (0 never). In a directional light's shadow maps the
  object moves in clipmap levels whose threshold distance (doubling per level) is not past its
  own; local lights' maps move it at any distance. Shadow settings:
  `shadowClipmapWpoDisableDistance` (`true`; `false` moves it in every level),
  `shadowClipmapWpoDisableDistanceLodBias` (3, 0 to 30) and
  `shadowClipmapWpoDisableDistanceInvalidateOnScaleChange` (`false`; `true` redraws a level when its
  threshold shifts with view resolution or fov).
- **`worldPositionOffsetWritesVelocity`** (boolean, `true`): TAA reprojects by the vertex's previous
  place. `false` costs less; a moving offset leaves a trail.
- **`shadowCacheInvalidation`** (`'auto'`, `'always'`, `'rigid'` or `'static'`, default `'auto'`):
  `auto` redraws shadow pages while the offset is evaluated (within its distance) or it moves;
  `always` every image; `rigid` only when it moves; `static` only on join or leave.
- **`mobility`** (`'static'`, `'stationary'` or `'movable'`, unset): `movable` keeps shadow pages in
  the dynamic layer from joining; others in the static layer until they first move; back to static
  after `shadowCacheFramesStaticThreshold` frames without a move. Unset: `movable` when a skin or
  morph deforms it, `static` otherwise; an object wearing an offset or displacement arrives in the
  dynamic layer whatever it says, unless shadow option `shadowCacheWpoPrimitives` (false) is on or
  `shadowCacheInvalidation = 'static'`. `undefined` restores the default.

View switches:

- **`firstPerson`** (boolean, `false`): first-person object (hands, weapon): pixels get the
  first-person shadow mark (`shadowFirstPersonPixelRequestBias`,
  `shadowFirstPersonRequestMinLevelClamp`); no dynamic shadow of its own.
- **`firstPersonWorldSpaceRepresentation`** (boolean, `false`): the player's body standing for it:
  the main camera does not draw it (reference `bOwnerNoSee`); it casts into a second sun clipmap
  (`shadowFirstPersonClipmap`, `docs/SHADOWS.md`), no regular map.
- **`castHiddenShadow`** (boolean, `false`): a hidden object (`visible = false`) keeps casting.
- **`holdout`** (boolean, `false`): with `film.propagateAlpha` and `film.primitiveAlphaHoldout` on,
  its pixels are black with alpha 1 and leave no surface to lighting, reflections or fog.

`firstPerson` with `firstPersonWorldSpaceRepresentation` on one node: `RangeError`.

```js
const arms = mesh(geometry, material)
arms.firstPerson = true
const body = mesh(geometry, material)
body.firstPersonWorldSpaceRepresentation = true // not drawn by the main camera, casts
const ghost = mesh(geometry, material)
ghost.castHiddenShadow = true
ghost.visible = false // casts, drawn by no view
const cutout = mesh(geometry, material)
cutout.holdout = true // a hole in the picture (film: propagateAlpha + primitiveAlphaHoldout)
```

## Who sees an object

Switches (`false` by default, saved with the world). A camera can name an **owner**,
`camera.owner = node` (`null`); that node and its descendants are _owned_ by the view.
**`ownerNoSee`** hides the object from views that own it; **`onlyOwnerSee`** draws it for those
alone (cameras naming no owner hide it). They add to a camera's `hidden` and `showOnly` lists
(`hidden` wins). A `firstPersonWorldSpaceRepresentation` stand-in is hidden from the main camera;
once a camera names an owner, from views that own it.

```js
// The player's hands are seen by the player's camera alone, its body by every other camera.
const player = object.group()
player.add(hands, body)
hands.onlyOwnerSee = true
body.ownerNoSee = true
const eye = camera.perspective({ fov: 70 })
eye.owner = player // the player's own camera: it sees the hands, not the body
const minimap = camera.perspective()
minimap.owner = null // a camera that names no owner sees the body, not the hands
```

## Bounds of the offset

Material options:

- **`maxWorldPositionOffset`** (metres, `0`): greatest move of a vertex along an axis; the offset is
  clamped to it and cluster bounds grow by it. With `0` a large offset can be culled at the view or
  shadow map edge.
- **`alwaysEvaluateWorldPositionOffset`** (boolean, `false`): evaluates the offset whatever
  `evaluateWorldPositionOffset` and `worldPositionOffsetDisableDistance` say.

Rays and distance fields see the surface at rest.
