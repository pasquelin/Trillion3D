# World position offset and object switches

## World position offset

`g.output('worldPositionOffset', offset)` moves every vertex of the surface by `offset`, a float3
in the world's axes and metres, evaluated for each vertex in every pass that places it: the
visibility buffer's two rasters, the shading of a pixel, the shadow maps (a swaying tree casts the
shadow of the shape it has), the translucent pass and the temporal anti-aliasing (which reprojects
a pixel by where its vertex was, so a moving surface leaves no trail). The offset sees what a vertex
has: `worldPosition()` (the vertex before the offset), `objectPosition()`, `cameraPosition()`,
`vertexNormal()`, `time()`, the parameters, **one** texture coordinate set (`texCoord(0)` is the
geometry's first set; a vertex weight painted in the second coordinate of the UVs is a common use)
and the textures it reads. It reads no `pixelNormal()` and no second texture set: a graph that
wires such an offset is refused (named once, `material-graph-refused`) and its surface is drawn
from the material's parameters, as any graph the engine does not compile. An offset that is not a
finite number is not corrected: the vertex goes where the number says.

What moves:

- the triangles of a surface;
- the corners of the flat triangles of a surface displaced by a height map (`displacementMap`),
  moved before the patch is cut and diced, so the patch is diced and displaced on the moved
  triangle;
- the bricks of voxels the far levels of a mesh are drawn as (`voxelize`), each brick rigidly, by
  the offset at the centre of its box, box and voxels alike: a swaying crown does not stop where the
  cut switches to voxels.

A sprite and a line are built on the screen and are not moved.

A texture read in the offset is read at the finest level (a vertex has no footprint) and asks no
tile: a tile that is not resident reads its fallback level. A device lets its vertex stages read the
colour atlas when it grants ten storage buffers a stage (`maxStorageBuffersPerShaderStage`, and
`maxStorageBuffersInVertexStage` where it reports one); the engine asks the adapter for all it
offers. On a device that grants fewer, a graph whose offset reads a texture is refused once
(`material-graph-refused`) and its surface is not moved. The shadow maps' splitting of a displaced
surface's patches judges them by the offsets that read no texture alone; the vertices drawn are
moved by all.

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

The object decides whether and how far its surfaces' offsets are evaluated (properties of the node,
saved with the world, written in place; the defaults are the reference's):

- **`evaluateWorldPositionOffset`** (boolean, `true`): `false` leaves the object's vertices where
  the geometry puts them.
- **`worldPositionOffsetDisableDistance`** (metres, `0`): past this distance from the camera to the
  centre of the object's bounds the offset stops (0 never stops it). In the shadow maps of a
  directional light the distance is the clipmap level's: an object that names one is moved in the
  levels whose threshold distance (the distance past which the level no longer shows the motion,
  doubling for each level coarser) is not past its own, and left at rest in the coarser ones; a
  local light's maps move it whatever the distance. A level's threshold counts the clipmap's whole
  resolution bias, the view's width and field of view included. Three settings of the shadow maps
  name the rule: `shadowClipmapWpoDisableDistance` (`true`; `false` moves the object in every
  level), `shadowClipmapWpoDisableDistanceLodBias` (3, from 0 to 30: the levels the rule is held
  back by) and `shadowClipmapWpoDisableDistanceInvalidateOnScaleChange` (`false`; `true` draws a
  level again when its threshold shifts with the view's resolution or field of view: steadier
  shadows of moving vegetation, at the price of redraw spikes).
- **`worldPositionOffsetWritesVelocity`** (boolean, `true`): whether the temporal anti-aliasing
  reprojects a pixel of the object by where its vertex was. `false` costs less where the offset
  does not change; with an offset that moves, it leaves a trail. The previous place is the offset
  of the image before (its clocks and camera) on the object where its previous world matrix put it.
- **`shadowCacheInvalidation`** (`'auto'`, `'always'`, `'rigid'` or `'static'`, `'auto'` by
  default): how the object's shadow pages are kept. `auto` draws them again while its offset is
  evaluated (not past its distance) or while it moves; `always` every image, for an animation the
  engine cannot know; `rigid` not for its offset, only when it moves; `static` not for its offset
  nor for its moves: a pose it takes later is not seen by its cached shadows, and the pages are
  drawn again when it joins or leaves the scene.
- **`mobility`** (`'static'`, `'stationary'` or `'movable'`, unset by default): whether the object
  is often moving. A `movable` object has its shadow pages kept in the dynamic layer of the shadow
  maps from the frame it joins the scene, so its arrival draws no page of the static layer; the
  others are kept in the static layer until they first move. Either returns to the static layer
  after `shadowCacheFramesStaticThreshold` frames without a move. Unset, the object is `movable`
  when a skin or a morph deforms it and `static` otherwise; an object whose surfaces wear an offset
  or a displacement arrives in the dynamic layer whatever it says, unless the shadow option
  `shadowCacheWpoPrimitives` (false) is on, and `shadowCacheInvalidation = 'static'` keeps it out
  of it. `undefined` gives back the default. It is saved with the world; a light keeps its own
  `mobility`, which is another setting.

Four more switches of the object say what it is to a view (all saved with the world):

- **`firstPerson`** (boolean, `false`) marks an object drawn as a first-person one (the hands and
  the weapon of a player, close to the camera): its pixels wear the first-person mark the shadows
  treat apart (`shadowFirstPersonPixelRequestBias`, `shadowFirstPersonRequestMinLevelClamp`), and it
  casts no dynamic shadow of its own.
- **`firstPersonWorldSpaceRepresentation`** (boolean, `false`) marks the object that stands for it
  in the world, the body of the player: the view that owns it, the main camera's, does not draw it
  (the reference forces `bOwnerNoSee` on it), and it casts into a second clipmap of each sun
  (`shadowFirstPersonClipmap`, `docs/SHADOWS.md`) and into no regular shadow map.
- **`castHiddenShadow`** (boolean, `false`) lets an object that is hidden (`visible = false`, or
  under a hidden node) go on casting its shadow while no view draws it (read for an object that
  casts and is no world-space representation).
- **`holdout`** (boolean, `false`) cuts the object out of the picture: with `film.propagateAlpha`
  and `film.primitiveAlphaHoldout` on, its pixels are black with an alpha of 1 (nothing of the scene
  shows there, the image keeps the hole), and they leave no surface to the lighting, the reflections
  or the fog. With either film setting off, the flag is ignored.

A node is a first-person object or its world-space representation, never both: setting one while
the other is on is refused (`RangeError`).

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

Two more switches, both `false` by default and saved with the world, hide an object by who looks. A
camera can name an **owner**, `camera.owner = node` (`null` by default): the node its view belongs
to, the player's. An object that is the owner or under it is _owned_ by that view. **`ownerNoSee`**
hides the object from the views that own it and draws it for every other view; **`onlyOwnerSee`**
draws it for the views that own it alone and hides it from every other, those of cameras that name
no owner included. A camera with no owner owns nothing. The two switches add to a camera's `hidden`
and `showOnly` lists, which still apply (`hidden` wins). Until a camera names an owner, the stand-in
of a first-person object (`firstPersonWorldSpaceRepresentation`) keeps its own rule, hidden from the
main camera; once one does, it is hidden from the views that own it, as an `ownerNoSee` object is.

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

Two options of the material bound the offset:

- **`maxWorldPositionOffset`** (metres, `0`): the greatest distance the offset may move a vertex
  along an axis. The offset is held to it, and the bounds of the surface's clusters grow by it where
  the view and the shadows decide what is seen; `0` holds nothing and grows nothing, so an offset
  that moves a surface out of its bounds can be cut away at the edge of the view or of a shadow map
  before the surface reaches it: name the greatest offset when it is large.
- **`alwaysEvaluateWorldPositionOffset`** (boolean, `false`): evaluates the offset whatever
  `evaluateWorldPositionOffset` and `worldPositionOffsetDisableDistance` say.

The rays that light the scene's reflections and indirect light, and the distance fields, see the
surface at rest.
