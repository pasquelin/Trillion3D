# Far casters

A sun's shadow maps follow the eye, and the reference's far-shadow test (`TestPrimitiveFarCascadeConditions`) leaves a
subject far past the distance they are asked to reach out of them — but only the subjects its CPU gathers, which are
no cluster geometry; no shader of its cluster or virtual-shadow-map culling carries the test. Every caster the engine
draws is made of clusters (`lighting/shadows/casters/casterFeed.ts`), so the maps take each of them at any distance, whether
its object casts far shadows or not, and nothing is left out by the test: the candidate kernel
(`vsmRenderCandidates`, `vsm/render/renderCandidatesWgsl.ts`) and the cull (`vsmRenderCull`) read no far-shadow
distance. No distance-field shadow takes the far geometry in their place on the view: the maps draw the clusters at
any distance, and every mesh the engine draws is made of clusters (see "The distance-field cascade" below).
`farShadowCulling` decides whether a sun has a near edge and the distance-field cascade that follows it; the
reference's test would act on a caster that is no cluster geometry, of which the engine has none, so it has no switch
for the test.

**The edge.** `sunCascades` (`packages/sdk-core/src/contracts/sunCascades.ts`) lays the sun's levels from its own
settings and the view's: the near levels (the light's `shadowCascades`, 4 by default, at most the view's
`shadowNearLevels`), each `shadowCascadeExponent` (3) times the span of the one before, an overlap of
`shadowCascadeTransition` (a tenth) of the last one's span times the view's `shadowOverlapScale`; the edge is the far
end of the last near level with that overlap (427 m at the defaults, the distance itself from 512 m on). Each map's projection record carries it
(`farShadowEdge`, 0 for none; a local light's is 0).

**The cache.** A sun's own shadow settings — the eight of the `LIGHT_SHADOW_FIELDS`: the distance, the cascades and the distance-field cascade's — are part of its clipmap's cache key (`lighting/shadows/vsm/lightCache.ts`): a sun
changed by one has no cached page of the old one, they are drawn again. The edge is not: what the view's
`shadowDistanceScale`, near levels, overlap and switches make of it each frame reaches the next frame's test, and
the cached pages are kept.

A cache entry is keyed by the light's id, the view it is drawn for and its shadow type (0 the regular maps, 1 a sun's
first-person clipmap), as one structural key (`vsmCacheKey`), so that a light named with a `#` and a view with any name
never share an entry. The first-person clipmap keeps its sun's own id and lives as long as the sun does (a removed light
takes all its entries). A placement that is parked or taken away goes back to static in the mobility state (`park`, called
by `flipWorld`): not moving, never moved, its pose kept (shown again where it stands, it is no move), its word written again by
`flipWorld`; a placement that takes its row later starts as a new one.

**A level's depth range and its moving casters.** A level that keeps pages draws its dynamic layer again each frame, so a
moving caster is culled past the end of what the level shows: with `shadowClipmapCullDynamicTightly` (true) the level's
projection record carries `dynamicDepthCullRange`, whose near-side limit is the clip depth of the point `cullingEnd` along
the light, `cullingEnd` being the level's radius at its level less the clipmap's resolution bias (the pool pressure bias
is not in it), and whose far-side limit is the largest float; the cull (`vsmRenderCullView`) reads both for the casters
not in the static layer, and a map that is not a clipmap level keeps `0` and the largest float. A clipmap that keeps no
page (`shadowForceInvalidateDirectional`, false; the first-person clipmap always) is drawn uncached, and with
`shadowClipmapCullDynamicTightly` its depth range itself is cut, from `depthRadius` on the near side to `cullingEnd` on
the far side, with no shift for the eye's depth.

**The width a sun's clipmap is sized for.** A sun's clipmap sizes its texels for the width the frame is drawn at, so a
render resolution lowered by the dynamic resolution or a quality level coarsens its shadows too.
`shadowClipmapMinCameraViewportWidth` (0, from 0 to 16384 pixels) floors that width (`VsmViewport.minScreenWidth`,
`planMaps`): a frame drawn narrower keeps the shadow resolution of that width; 0 floors nothing. Local lights read the
drawn size alone.

```ts
world.shadows = { shadowClipmapMinCameraViewportWidth: 1920 } // a lowered render resolution keeps 1920-pixel sun shadows
```

**The lights a perspective view draws.** A point, spot or rectangle light too small on the screen or past its own distance is
left out of the view, its shadow maps and its lighting both. The rule (`lightDrawn`, `lighting/lightDrawRange.ts`, reading the light's
record: `SceneLightStore.draw`) is decided once for each light and each view, on the CPU, on the squared distances;
the decision rides in one bit of the light's own record, which the light grid's lists and the walk of every light read, and the shadow
plan's `vsmLightSeen` asks the rule itself. A light is measured by its bounding sphere (`coneSphereAlong`, `coneSphereRadius` for a spot): the
ball of its range around its position for a point or a rectangle; for a spot, the sphere that holds its cone, centred along its
axis — `range * cos(outer)` along with the radius `range * sin(outer)` for a cone wider than 45 degrees, else the radius
`range / (2 * cos(outer))`, centred that far. A light of bounding radius `W` metres whose sphere's centre is at the distance `d`
is drawn while `min(0.02, lightMinScreenRadius / W) * factor * d < 1` — `lightMinScreenRadius` 0.03, `factor` the view's horizontal
field of view in degrees over 90, or 1 where `lightDrawRangeFollowsFieldOfView` is `false` (default `true`): a light of 1.5 m or less,
or of no range, is left out past 50 m, a larger one past `W / 0.03` — and, when it names a
`maxDrawDistance` above 0 (`SceneLight.maxDrawDistance`, metres), while `d < maxDrawDistance * lightMaxDrawDistanceScale`
(`lightMaxDrawDistanceScale` 1; a scale of 0 leaves out every light that names a distance). A `maxDrawDistance` of 0 is no limit; a directional light and an orthographic view always
draw. `lightMinScreenRadius` 0 leaves no light out by its size.

```ts
world.shadows = { lightMinScreenRadius: 0.06 } // small lights are left out twice as near
```

**An orthographic view's clipmaps.** A perspective view centres a sun's clipmap on its eye. An orthographic camera can
stand far from what it shows, so four settings, at their defaults, centre and size the clipmap on what it frames.
`shadowOrthoEstimateClipmapLevels` (true) starts the first level from the width of the view's box (the level of half
that width, never under `shadowClipmapFirstLevel`) and `shadowOrthoClipmapLodBias` (0, from -30 to 30) adds that many
whole levels to it, never below level 0; with the estimate off the first level is `shadowClipmapFirstLevel`.

`shadowOrthoProjectViewOrigin` (true) moves the clipmap's origin from the eye onto the camera's `viewTarget`: the offset
from the eye to the framed point, in the camera's own frame, so it follows a rig that moves the camera (read while the
view works its planes out, `cutViewOrthoAutoPlanes`, below). Write it with
`camera.setViewTarget(point)` (a point of the frame the camera's `position` is in; `null` frames none) or `camera.set(pose)`
(the pose's world target); the orbit, trackball and pan-zoom controls write their pivot, and the fly, first-person and
character controls frame none.

Where the camera frames none, `shadowOrthoRayCastViewOrigin` (true) centres the clipmap on the first body the camera's
line of sight meets in the physics: from the eye along the view, as far as the projection's depth spans, against every
object type, complex collision, through the body of the camera the view is drawn from, if it has one. It needs a casting
sun and the physics on (`world.physics.enabled`), and meets only what the physics streams; a line that meets nothing
leaves the clipmap on the eye. The physics answers from its worker, so the clipmap uses the previous answer; the view
asks again when its ray or the physics' world changes.

```ts
world.camera.setViewTarget(city.position) // an orthographic view frames the city
world.shadows = {
  shadowOrthoProjectViewOrigin: true, // the clipmaps centre on the city, not on the camera (the default)
  shadowOrthoRayCastViewOrigin: false, // a camera with no target stays on the camera
  shadowOrthoEstimateClipmapLevels: true, // the first level follows the box's width (the default)
  shadowOrthoClipmapLodBias: 1, // one level coarser, for fewer pages
}
```

**An orthographic view's origin and range.** An orthographic camera can stand far behind what it shows, with its
near plane behind it. Before any pass reads the view, its near and far plane are worked out and its origin is moved
onto the near plane, so light resolved at the origin (the clipmaps among it) is resolved where the picture begins and
nothing in the foreground is clipped. The planes come first, then the move. `cutViewOrthoAutoPlanes` (true) works the
planes out from the box's width, the view's angle to the ground, the distance to the point the camera frames and the
picture's size in pixels; false keeps the near and far the camera declares, and the point it frames is not carried
(`camera.viewTarget` stays as the camera's own and is not read by the clipmaps). A perspective camera is never worked
out. In metres, with the settings at their defaults:

- the box's width and height are `width / aspect`; the view's angle gives a cosine, 1 looking straight down, 0 level;
- the far plane scales with the size of a pixel in the world when `cutViewOrthoAutoPlanesHalfFloat` (true) is on, so a
  pass that downsizes depth in half floats keeps it: the height over the picture's rows, rounded down (in centimetres),
  its logarithm with `cutViewOrthoAutoPlanesScaleUnits` (true), times 655.04 m, held between 655.04 m and the world's
  reach; `cutViewOrthoAutoPlanesDepthScale` (-1) above 0 replaces 655.04 m by a shorter depth. With the half-float scale
  off, or no picture size, the far plane is the height over the cosine, a level view reaching the world's;
- the near plane is behind the origin by up to half the box's larger side, less the distance to the framed point times
  the cosine;
- `cutViewOrthoAutoPlanesShift` (0 m) moves both planes along the view.

`cutViewOrthoNearPlaneCorrection` (true) then turns the move on; false leaves the origin as the camera has it. A camera
with a `viewTarget` puts its origin on the target, moved along the view by `near`; the target keeps its place, so its
offset from the origin shrinks to `near`. A camera with none moves its origin along the view by `near`, and, with
`cutViewOrthoCameraHeightAsViewTarget` (true), by one more length: its height above the ground, or the box's half width
as drawn if that is smaller, times the view's slope against the vertical (the more it looks straight down, the more it
moves). The range then starts at `cutViewOrthoNearPlane` (0 m) and keeps its length `far - near`. The physics sends an
orthographic camera's view from that origin and to that far plane, from the last image drawn.

```ts
world.camera.setViewTarget(city.position) // the origin goes onto the city, `near` back along the view
world.cut = {
  cutViewOrthoAutoPlanes: true, // the planes are worked out from the box and the picture (the default)
  cutViewOrthoAutoPlanesHalfFloat: true, // the far plane scales with the size of a pixel (the default)
  cutViewOrthoAutoPlanesScaleUnits: true, // by its logarithm (the default)
  cutViewOrthoAutoPlanesDepthScale: -1, // from the half float's largest depth, 655.04 m (the default)
  cutViewOrthoAutoPlanesShift: 0, // both planes stay where they are worked out (the default)
  cutViewOrthoNearPlaneCorrection: true, // the origin and the range are corrected (the default)
  cutViewOrthoCameraHeightAsViewTarget: true, // a camera with no target uses its height (the default)
  cutViewOrthoNearPlane: 0, // the corrected range starts at 0 m (the default)
}
```

**The cache's and the receiver masks' switches.** Each is a view setting at the reference's default.
`shadowCache` (true) keeps the pages from one frame to the next: off, every light is drawn uncached each frame, the
distant lights are never kept, and the set is made without a static layer in its pool (`VsmLayout.cacheEnabled`), so
a change makes the set again (`heldVsm`) and drops its pages. `shadowForceInvalidateLocal` (0) draws the local lights
uncached each frame: 1 those that are not distant, 2 all of them (`addVsmLocalLightShadow`).
`shadowCacheAllocateViaLru` (true) keeps the pool sort's order (empty pages first, then the page wanted longest ago,
frame by frame, with no level order; pages of one age in pool order); off, `poolSlotRank` ranks every page not wanted this frame alike,
so the empty pages go first, then the highest pool index (`poolPage`, `VsmPmParams.lruAllocation`). `shadowForceFullPageClears` (false) clears a stale page's
layers whatever the cleared bits say (`VsmPmParams.fullClears`, `vsmListClears`).
A placement that a skin or a morph deforms is cached as dynamic while it deforms.
`shadowUseReceiverMaskDirectional` (true) and `shadowUseReceiverMaskLocal` (false) give a light's maps the receiver cover
(`VSM_MAP_COVERAGE`, `VsmLightCache.useCover`): a page of a map with it is drawn only for the receivers its mask holds and
its dynamic layer is drawn again each frame; a change of the setting draws the light's pages again, and the sun's
dynamic depth range is cut by `shadowClipmapCullDynamicTightly` only while its cover is on. The cover is sized for the
suns' maps alone; with the local setting on it is sized for every map (`VsmLayout.coverMode` `all`) and the set is made again.
`shadowDynamicDeallocationMode` (0, from 0 to 2) is what a frame at `shadowQuality` 0 does with the set held (`planNoShadows`):
1 frees it (`releaseEngineVsm`: the pool, the tables, the cache), 0 and 2 keep it and drop its cache (`dropEngineVsmCache`: the
previous frame forgotten, every light's entry invalidated, so the first frame that shadows again draws each light uncached; no
page is read that the casters, changing unseen, could have left stale; the plan and the reads it left pending are forgotten, and the
set counts no light and no map, so the panel shows 0 and the inspection no map, and each such frame settles it at once, `noteVsmIdleFrame`). Mode 0 frees only where a many-light shading mode is in
use, which this engine does not have, so it behaves as 2: the pool's memory is held while the shadows are off, and a toggle of
`shadowQuality` makes no set again. `shadowCacheDebugSkipDynamicPageInvalidation` (false) is a debugging switch: the page
management applies none of the invalidations a cached page carries (the static and dynamic ones of the moved casters, the
deferred ones, which keep their mark, and the receiver cover's redraw; `VsmPmParams.skipDynamicInvalidation`, `vsmKeepPages`), so a
moved object leaves its old shadow in the pages. It skips no more: a page cached whole under an offset the map allows keeps the
dynamic-stale mark that has the casters' cull consider it (nothing is cleared or drawn in it; it is no invalidation, and the
reference leaves it on too: `VirtualShadowMapPhysicalPageManagement.usf` 443, where the switch only clears `bDynamicPageInvalidation`,
`VirtualShadowMapArray.cpp` 3294, and so the block of 328).

**The distance-field cascade.** The same levels shape the cascade after them, from the near levels' end to
`distanceFieldShadowDistance` (`sunCascades`): with virtual shadow maps it moves the far-shadow test's edge, and nothing is traced on the view
with it. With classic shadow maps (`shadowVirtualEnable` off) it is traced (`lighting/shadows/classic/fieldShadow/`): the meshes are culled to the slice of
the frustum between the last cascade's end and the distance, listed by tile across the sun, a ray from each pixel (half the image, `distanceFieldShadowFullResolution`)
is walked through its tile's meshes' fields, and the result is upsampled by the depth, faded in over the last cascade's fade and out over the cascade's own, and laid into the sun's mask by the minimum.
With virtual shadow maps the sun's shadow maps draw every cluster at any distance (`vsmFarShadow.ts`), and every placement the engine
draws is made of clusters, so a distance-field shadow of the view would shadow nothing: the reference leaves the
Nanite geometry out of the cascade of a sun that has virtual shadow maps (`DistanceFieldShadowing.cpp` 654-655) and
the engine has no mesh that is no cluster geometry, so the virtual path has no such pass, mask or setting. The distance fields
of the meshes shade one thing of the sun: the cards of the surface cache, which the shadow maps do not reach. For each
sun with shadows, the meshes that cast are listed by tile of a shadow space across the sun over the cube the cards are
kept in (`lighting/surfaceCache/lighting/meshShadow.ts`), every mesh, the ones made of clusters too, and the cards'
direct light traces its rays through the tile's meshes. The meshes are tracked beside the cut's
roots (`lighting/distanceField/objectTracker.ts`): the placements of compiled meshes that have a field, and the
fields of the world DAG's HLOD cells (`lighting/distanceField/hlodObjects.ts`: a stand-in for each cell and each
instance of the world DAG, placed only while the cut draws the cell's actor, so the shadow of a merged shell is
drawn exactly where the shell is; the layer's `allowDistanceField` asks the compiler for them). No far level
is drawn: the levels a light's `farShadowCascades` ask for are counted — a light with some ends its near levels
with the overlap and lets the cascade fade out by it —, never drawn. The count of near levels, the scale on
the overlap and the far field are settings (`shadowNearLevels`, `shadowOverlapScale`, `shadowFarField`,
`packages/sdk-core/src/contracts/shadowOptions.ts`, `sunShadowOptions.ts`); the growth, the overlap's tenth and the
512 m are the light's own settings (`packages/sdk-core/src/contracts/lightShadowOptions.ts`).

The cards' lists, in the reference's order (`lighting/distanceField/shadow/frame.ts`), run before the surface cache's
lighting. Per sun: the meshes culled to the volume's hull (the hull of the cube and of the silhouette edges extruded
along the light, at most 12 planes); then their boxes drawn onto the grid of tiles across the light once to count the
meshes of each tile, the tiles' start offsets summed, and drawn again to write the lists — the count and the offsets
only where the lists are compacted (`distanceFieldShadowCompactTiles`, on; off, each tile has a place of its own, the
room over the tiles, and a tile past its place loses meshes).

**The shadow space.** The cards' cube is held in a sphere; the space the tiles are cut across is
the sphere's: the light's right and up over the sphere's radius rounded up to a centimetre, the depth toward the
light over twice the greater of that radius and 5000 centimetres, so a small volume still sees the meshes 50 metres either side. The tile grid (a radius over the tile's size and one, at most 256
tiles across, a multiple of 64) and the growth of the boxes read the sphere's own radius, not the rounded one. The
space's origin is snapped across the light to a grid fixed in the world, 4 texels of a map of
`distanceFieldShadowSnapResolution` texels (2048, less 4 each side) a step, so the grid moves in steps with the
camera, not with it.

A caster whose object names draw distances it lies outside of (`drawDistance`,
[ENGINE.md](../engine/webgpu-page-raster.md#webgpu-page-raster)) is left out by the same kernel, before the far test, from
the main view's eye in every pass of the light: the object's centre against its distances, scaled
by the cut's view distance scale alone (no field of view scale); an instance's share follows
`cutDrawDistanceCulling`.
