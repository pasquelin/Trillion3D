# Far casters

The reference's far-shadow test (`TestPrimitiveFarCascadeConditions`) drops far non-cluster
subjects. Every engine caster is clusters (`lighting/shadows/casters/casterFeed.ts`), so the maps take
each at any distance; the candidate kernel (`vsmRenderCandidates`,
`vsm/render/renderCandidatesWgsl.ts`) and the cull (`vsmRenderCull`) read no far-shadow distance.
`farShadowCulling` decides whether a sun has a near edge and the distance-field cascade after it;
the reference's test has no switch.

**The edge.** `sunCascades` (`packages/sdk-core/src/contracts/sunCascades.ts`) lays the sun's levels:
near levels (light's `shadowCascades`, 4 by default, at most the view's `shadowNearLevels`), each
`shadowCascadeExponent` (3) times the previous span, overlap `shadowCascadeTransition` (a tenth) of
the last span times the view's `shadowOverlapScale`; the edge is the last near level's far end plus
that overlap (427 m at defaults, the distance itself from 512 m on), carried by each map's projection
record (`farShadowEdge`, 0 for none; a local light's is 0).

**The cache.** A sun's eight `LIGHT_SHADOW_FIELDS` (distance, cascades, distance-field cascade's) are
in its clipmap's cache key (`lighting/shadows/vsm/lightCache.ts`): changing one redraws the sun. The
edge is not in it; cached pages are kept when the view's `shadowDistanceScale` etc. change it.

A cache entry is keyed by light id, view and shadow type (0 regular maps, 1 a sun's first-person
clipmap) as one structural key (`vsmCacheKey`). The first-person clipmap keeps its sun's id and lives
as long as the sun. A placement parked or taken away goes back to static in the mobility state
(`park`, called by `flipWorld`): not moving, never moved, pose kept; a placement that takes its row
later starts as new.

**A level's depth range and its moving casters.** A level that keeps pages redraws its dynamic layer
each frame. With `shadowClipmapCullDynamicTightly` (true) its projection record carries
`dynamicDepthCullRange`: near limit the clip depth of the point `cullingEnd` along the light
(level radius less the clipmap's resolution bias), far limit the largest float; `vsmRenderCullView`
reads both for casters not in the static layer; a non-clipmap map keeps `0` and the largest float. A
clipmap that keeps no page (`shadowForceInvalidateDirectional`, false; the first-person clipmap
always) is drawn uncached, its depth range cut from `depthRadius` (near) to `cullingEnd` (far).

**The width a sun's clipmap is sized for.** `shadowClipmapMinCameraViewportWidth` (0, 0 to 16384
pixels) floors the drawn width the clipmap sizes texels for (`VsmViewport.minScreenWidth`,
`planMaps`); 0 floors nothing. Local lights read the drawn size alone.

```ts
world.shadows = { shadowClipmapMinCameraViewportWidth: 1920 } // a lowered render resolution keeps 1920-pixel sun shadows
```

**The lights a perspective view draws.** A point, spot or rectangle light too small on screen or past
its distance is left out (shadow maps and lighting). The rule (`lightDrawn`,
`lighting/lightDrawRange.ts`, `SceneLightStore.draw`) is decided per light and view on the CPU in one
bit of the light's record; `vsmLightSeen` asks the rule itself. Bounding sphere (`coneSphereAlong`, `coneSphereRadius` for a spot): range ball at the position for a
point or rectangle; for a spot, the sphere holding its cone, centred along the axis:
`range * cos(outer)` along, radius `range * sin(outer)` for a cone wider than 45 degrees, else radius
`range / (2 * cos(outer))`, centred that far. A light of bounding radius `W` metres, centre at
distance `d`, is drawn while `min(0.02, lightMinScreenRadius / W) * factor * d < 1`:
`lightMinScreenRadius` 0.03, `factor` the horizontal field of view in degrees over 90, or 1 where
`lightDrawRangeFollowsFieldOfView` is `false` (default `true`); so a light of 1.5 m or less, or no
range, is left out past 50 m, a larger one past `W / 0.03`. With a `maxDrawDistance` above 0
(`SceneLight.maxDrawDistance`, metres) also while `d < maxDrawDistance * lightMaxDrawDistanceScale`
(`lightMaxDrawDistanceScale` 1; 0 leaves out every light naming a distance); 0 is no limit.
Directional lights and orthographic views always draw. `lightMinScreenRadius` 0 leaves no light out
by size.

```ts
world.shadows = { lightMinScreenRadius: 0.06 } // small lights are left out twice as near
```

**An orthographic view's clipmaps.** A perspective view centres a sun's clipmap on its eye; four
settings centre and size it on what an orthographic camera frames.
`shadowOrthoEstimateClipmapLevels` (true) starts the first level at half the view box's width (never
under `shadowClipmapFirstLevel`); `shadowOrthoClipmapLodBias` (0, -30 to 30) adds that many whole
levels, never below 0; estimate off: first level `shadowClipmapFirstLevel`.

`shadowOrthoProjectViewOrigin` (true) moves the clipmap origin from the eye onto the camera's
`viewTarget` (read while the view works its planes out, `cutViewOrthoAutoPlanes`). Write it with
`camera.setViewTarget(point)` (a point in the frame of the camera's `position`; `null` frames none)
or `camera.set(pose)` (the pose's world target); orbit, trackball and pan-zoom controls write their
pivot; fly, first-person and character controls frame none.

Where the camera frames none, `shadowOrthoRayCastViewOrigin` (true) centres the clipmap on the first
physics body the line of sight meets (eye along the view, as far as the projection's depth, all
object types, complex collision, through the view camera's own body). Needs a casting sun and
`world.physics.enabled`; no hit leaves the clipmap on the eye; the previous physics answer is used.

```ts
world.camera.setViewTarget(city.position) // an orthographic view frames the city
world.shadows = {
  shadowOrthoProjectViewOrigin: true, // the clipmaps centre on the city, not on the camera (the default)
  shadowOrthoRayCastViewOrigin: false, // a camera with no target stays on the camera
  shadowOrthoEstimateClipmapLevels: true, // the first level follows the box's width (the default)
  shadowOrthoClipmapLodBias: 1, // one level coarser, for fewer pages
}
```

**An orthographic view's origin and range.** Before any pass reads the view, its near and far planes
are worked out, then its origin moved onto the near plane. `cutViewOrthoAutoPlanes` (true) works the
planes out from the box's width, the view's angle to the ground, the distance to the framed point and
the picture's size in pixels; false keeps the camera's near and far and the clipmaps do not read
`camera.viewTarget`. Perspective cameras are untouched. In metres:

- box width and height are `width / aspect`; the view's angle gives a cosine, 1 straight down, 0 level;
- far, when `cutViewOrthoAutoPlanesHalfFloat` (true): height over the picture's rows, rounded down (in
  centimetres), its logarithm with `cutViewOrthoAutoPlanesScaleUnits` (true), times 655.04 m, held
  between 655.04 m and the world's reach; `cutViewOrthoAutoPlanesDepthScale` (-1) above 0 replaces
  655.04 m. Half-float off, or no picture size: height over the cosine (a level view reaches the
  world's);
- near is behind the origin by up to half the box's larger side, less the distance to the framed
  point times the cosine;
- `cutViewOrthoAutoPlanesShift` (0 m) moves both planes along the view.

`cutViewOrthoNearPlaneCorrection` (true) turns the move on; false leaves the camera's origin. With a
`viewTarget` the origin goes onto the target, moved along the view by `near`. With none it moves along
the view by `near` and, with `cutViewOrthoCameraHeightAsViewTarget` (true), by its height above the
ground (or the box's half width if smaller) times the view's slope against the vertical. The range
then starts at `cutViewOrthoNearPlane` (0 m) and keeps its length `far - near`. The physics gets the
view from that origin to that far plane (last image drawn).

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

**The cache's and the receiver masks' switches.** View settings at the reference default.
- `shadowCache` (true): off, every light is drawn uncached each frame, distant lights never kept, the
  pool has no static layer (`VsmLayout.cacheEnabled`); a change makes the set again (`heldVsm`).
- `shadowForceInvalidateLocal` (0): local lights uncached each frame; 1 those not distant, 2 all
  (`addVsmLocalLightShadow`).
- `shadowCacheAllocateViaLru` (true): pool order is empty pages, then the page wanted longest ago;
  off, `poolSlotRank` ranks pages not wanted this frame alike: empty first, then highest pool index
  (`poolPage`, `VsmPmParams.lruAllocation`).
- `shadowForceFullPageClears` (false): clears a stale page's layers regardless of the cleared bits
  (`VsmPmParams.fullClears`, `vsmListClears`).
- A skinned or morphed placement is cached as dynamic while it deforms.
- `shadowUseReceiverMaskDirectional` (true), `shadowUseReceiverMaskLocal` (false): the light's maps
  get the receiver cover (`VSM_MAP_COVERAGE`, `VsmLightCache.useCover`): a page is drawn only for the
  receivers its mask holds, its dynamic layer redrawn each frame; a change redraws the light's pages;
  the sun's depth cut by `shadowClipmapCullDynamicTightly` applies only while its cover is on. Cover
  covers suns' maps; local setting on: every map (`VsmLayout.coverMode` `all`), set made again.
- `shadowDynamicDeallocationMode` (0, 0 to 2): what a frame at `shadowQuality` 0 does with the set
  (`planNoShadows`). 1 frees it (`releaseEngineVsm`: pool, tables, cache). 0 and 2 keep it and drop
  its cache (`dropEngineVsmCache`: entries invalidated, the first frame that shadows again draws
  each light uncached; the set counts no light or map; `noteVsmIdleFrame`). 0 behaves as 2 (it frees
  only for a many-light shading mode, which the engine lacks): pool memory is held.
- `shadowCacheDebugSkipDynamicPageInvalidation` (false), debugging: page management applies none of
  a cached page's invalidations (static and dynamic ones of moved casters, deferred ones, receiver
  cover's redraw; `VsmPmParams.skipDynamicInvalidation`, `vsmKeepPages`), so a moved object leaves
  its old shadow. A page cached whole under an allowed offset keeps its dynamic-stale mark
  (reference too: `VirtualShadowMapPhysicalPageManagement.usf` 443, 328;
  `bDynamicPageInvalidation`, `VirtualShadowMapArray.cpp` 3294).

**The distance-field cascade.** The same levels shape the cascade after them, from the near levels'
end to `distanceFieldShadowDistance` (`sunCascades`). With virtual shadow maps it only moves the
far-shadow test's edge; nothing is traced on the view (no such pass, mask or setting:
`vsmFarShadow.ts`; reference `DistanceFieldShadowing.cpp` 654-655 leaves Nanite out). With classic
shadow maps (`shadowVirtualEnable` off) it is traced (`lighting/shadows/classic/fieldShadow/`):
meshes culled to the frustum slice from the last cascade's end to the distance, listed by tile across
the sun, a ray per pixel (half the image, `distanceFieldShadowFullResolution`) walked through its
tile's meshes' fields, upsampled by depth, faded in over the last cascade's fade and out over its
own, laid into the sun's mask by the minimum. Distance fields also shade the surface cache's cards:
per sun with shadows, casting meshes (clusters too) are listed by tile of a shadow space across the
sun over the cards' cube (`lighting/surfaceCache/lighting/meshShadow.ts`); the cards' direct light
traces through the tile's meshes. Meshes are tracked beside the cut's roots
(`lighting/distanceField/objectTracker.ts`): placements of compiled meshes with a field, and the
fields of the world DAG's HLOD cells (`lighting/distanceField/hlodObjects.ts`: a stand-in per cell
and instance, placed only while the cut draws the cell's actor; the layer's `allowDistanceField` asks
the compiler for them). No far level is drawn: the levels a light's `farShadowCascades` ask for are
only counted (a light with some ends its near levels with the overlap and fades the cascade out by
it). Settings: `shadowNearLevels`, `shadowOverlapScale`, `shadowFarField`
(`packages/sdk-core/src/contracts/shadowOptions.ts`, `sunShadowOptions.ts`); growth, overlap's tenth
and the 512 m are the light's (`packages/sdk-core/src/contracts/lightShadowOptions.ts`).

The cards' lists (`lighting/distanceField/shadow/frame.ts`, reference order) run before the surface
cache's lighting. Per sun: meshes culled to the volume's hull (cube and silhouette edges extruded
along the light, at most 12 planes); boxes drawn onto the tile grid across the light to count meshes
per tile, offsets summed, drawn again to write the lists; count and offsets only where lists are
compacted (`distanceFieldShadowCompactTiles`, on; off, each tile has its own place and a tile past it
loses meshes).

**The shadow space.** The cards' cube is held in a sphere: light's right and up over the radius
rounded up to a centimetre, depth over twice the greater of that radius and 5000 cm. The tile grid (a
radius over the tile's size and one, at most 256 tiles across, a multiple of 64) and the boxes'
growth read the sphere's own radius. The origin snaps across the light to a world-fixed grid, 4
texels of a map of `distanceFieldShadowSnapResolution` texels (2048, less 4 each side) a step.

A caster outside its object's draw distances (`drawDistance`,
[ENGINE.md](../engine/webgpu-page-raster.md#webgpu-page-raster)) is left out by the same kernel,
before the far test, from the main view's eye in every pass of the light: the object's centre against
its distances, scaled by the cut's view distance scale alone; an instance's share follows
`cutDrawDistanceCulling`.
