# Classic shadow maps

`shadowVirtualEnable` (`true`) keeps the virtual shadow maps. Set to `false`, every light takes a
classic shadow map instead: a map of fixed resolution whose pages are all resident, asked for by the
lights and not by the pixels of the view (no marking), and drawn by the same raster, into a depth atlas
(a tile a map, `classic/atlas/`) joined to the same pool. The atlas copies the pool's pages into its
tiles, draws the casters over them, and copies the tiles back by maximum; its options are
`shadowCacheWholeScene`, `shadowCachedCastFromMovable`, `shadowMaxPointCacheUpdatesPerFrame`,
`shadowMaxSpotCacheUpdatesPerFrame` and `shadowWholeSceneCacheMb`.

The constant and slope biases of a sun's cascade and of a spot light's map are applied at the draw, per
vertex, from the vertex's normal against the light's axis (`classic/atlas/drawBias.ts`,
`atlasTileWgsl.ts`); the pool raster that draws the voxel rows, and every row while the atlas pipelines
compile, applies the same words (a voxel box takes the slope of the face it draws). A point light's cube
is biased at its receivers (`classicTraceWgsl.ts`). Each cascade is a shadow map of its own, one past the
sun's clipmap levels, over the geometry of the level its texels fit: two cascades of one level are two
maps, each with its own pages, cache record and bias.

- A sun is drawn in cascades. Its distance (400 m by default) times `shadowDistanceScale` (0 to 2) is
  divided in `min(4, shadowCsmMaxCascades)` cascades, each three times as long as the one before; a
  cascade fades into the next over a tenth of its length times `shadowCsmTransitionScale` (0 to 2). A
  cascade is drawn in the clipmap level whose texels are the nearest at or above those
  `shadowMaxCsmResolution` (2048) texels over its bounding sphere give, over the pages that sphere
  covers. `shadowMaxCsmResolution` is held to the atlas side less a page (device limit,
  `shadowWholeSceneCacheMb`), so a cascade too large for the atlas takes a coarser level, never none. An
  orthographic view draws no cascade.
- A local light is drawn in one mip of its map, whose texels are the nearest at or under its resolution
  (the gate's, above), over every page.
- The biases are `shadowCsmDepthBias` (10), `shadowCsmSlopeScaleDepthBias` (3),
  `shadowCsmReceiverBias` (0.9), `shadowCsmSplitPenumbraScale` (0.5), `shadowTransitionScale` (60),
  `shadowPointLightDepthBias` (0.02), `shadowPointLightSlopeScaleDepthBias` (3),
  `shadowSpotLightDepthBias` (3), `shadowSpotLightSlopeScaleDepthBias` (3),
  `shadowSpotLightTransitionScale` (60) and `shadowSpotLightReceiverBias` (0.5).

```js
const world = createWorld('viewer', { shadowVirtualEnable: false, shadowCsmMaxCascades: 3 }) // classic maps, three cascades
```
