# Cut settings and draw distances

An object naming a draw distance (`objectSettings.drawDistance`,
[COMPILER.md](../../compiler/the-partitions-grids.md#object-settings)) is tested before its frustum
test, from the main view's eye, on the sphere of its root's bounds (half the box's diagonal about its
centre at the placement's pose, at most the half diagonal of the posed box). It is culled while the
sphere lies wholly nearer than `min` or wholly farther than `max`; with `cutDistanceCullToSphereEdge`
off, while its centre does. One instance (`perInstance`) is tested at its centre. Scales:

- an object of its own: `cutViewDistanceScale` (times `cutViewDistanceSecondaryScale` where
  `cutViewDistanceApplySecondaryScale` is on) and the horizontal field of view's scale:
  `cutViewDistanceFovMinAngleScale` at `cutViewDistanceFovMinAngle` and under,
  `cutViewDistanceFovMaxAngleScale` at `cutViewDistanceFovMaxAngle` and over, linear between;
  orthographic counts as 0 degrees;
- an instance: the first scale alone.

`cutDrawDistanceCulling` turns the cull off for instances alone. A group of 64 placements is culled
only where none can be drawn: its box's centre distance, nearer or farther by twice the box's half
diagonal, lies outside their nearest and farthest distance (smaller scale for nearest, larger for
farthest). A group with a placement naming no distance is never culled by it, nor is any while
`cutDrawDistanceCulling` is off; a one-pass cut tests placements alone.
An out-of-distance object casts no shadow in the virtual shadow maps (tested at its bounds' centre with
`cutViewDistanceScale` alone; instances follow `cutDrawDistanceCulling`). Bounce and reflection rays: an
object of its own is judged on its farthest distance alone, an instance on both at its centre, none
while `cutDrawDistanceCulling` is off. No fade over a travel distance; the reference's fifth field of
view setting (HLOD draw distances) has no counterpart.

Settings default to reference's, are world options by field, held over the quality preset (a level
writes only `cutViewDistanceScale`), changed by `world.cut` from the next frame
(`packages/sdk-core/src/contracts/cutOptions.ts`); a value a setting does not take is refused.

```ts
const world = createWorld(canvas, { cutTwoPassOcclusion: false })
world.cut = { cutLodBiasFollowsUpscale: false, cutLodBiasMin: -1 }
world.cut = { cutTwoPassOcclusion: null } // back to the preset's, here the default
```

Levels write `cutViewDistanceScale`: 0.4 at `smooth`, 0.6 at `balanced`, 0.8 at `fine`; `max` none (1),
`cinematic` 10. `pixelError` keeps its default.

```ts
const world = createWorld(canvas, { quality: { preset: 'balanced' } })
// cutViewDistanceScale is 0.6: every draw distance is 60 % of what the scene names
world.cut = { cutViewDistanceScale: 1 } // the page's value holds over the preset
world.cut = { cutDrawDistanceCulling: false } // every instance drawn at every distance
world.cut = { cutViewDistanceFovMaxAngleScale: 0.5 } // an object of its own: halved at 90 degrees and over
```

**The draw distances' second scale.** The product of `cutViewDistanceScale` and, when
`cutViewDistanceApplySecondaryScale` is `true`, `cutViewDistanceSecondaryScale` (`viewDistanceFactor`)
is read by the cut, the rays' scene and the shadow casters.
`world.cut = { cutViewDistanceApplySecondaryScale: true, cutViewDistanceSecondaryScale: 0.5 }` halves
every draw distance.

**A GPU time budget for the cut.** `cutEdgeScaleBudgetMs` gives the main view's cut and raster
a time in ms. It is a budget of the dynamic resolution's heuristic ([Dynamic resolution](../temporal-antialiasing.md#dynamic-resolution),
`frame/scale/dynamicResolution.ts`), so it works only where the render scale is `'auto'`. The main
view's cut threshold is `pixelError / fraction`, the fraction between `cutEdgeScaleMinPercent` / 100
and 1 and the lesser of it and the streaming quality scale. Each image suggests
`fraction · budget · 0.95 / time`; a change under 1 % is none.

```ts
const world = createWorld(canvas, { renderScale: 'auto', cutEdgeScaleBudgetMs: 6 })
// over 6 ms the main view's pixels per edge grow, up to 1 / 0.3 times pixelError, and come back under it
world.cut = { cutEdgeScaleMinPercent: 50 } // never coarser than 2 × pixelError
world.cut = { cutEdgeScaleBudgetMs: null } // no budget again: the threshold is the host's
```

| Field | Meaning | Default |
| - | - | - |
| `cutTwoPassOcclusion` | Two passes per view; `false`, one that occludes nothing | `true` |
| `cutOcclusionCulling` | Boxes tested against depth pyramids | `true` |
| `cutFrustumCulling` | Boxes outside the frustum rejected | `true` |
| `cutMinLodCulling` | Prunes a leaf whose least error still shows at its nearest | `true` |
| `cutDrawDistanceCulling` | Culls instances outside their draw distances; objects of their own always culled | `true` |
| `cutDistanceCullToSphereEdge` | Distance to the bounds sphere's edge; `false`, to its centre | `true` |
| `cutViewDistanceScale` | Scale of every draw distance, finite, at least 0 | `1` |
| `cutViewDistanceApplySecondaryScale` | Secondary scale multiplies the distances | `false` |
| `cutViewDistanceSecondaryScale` | Second scale, 0 or more | `1` |
| `cutViewDistanceFovMinAngle` | Horizontal field of view, degrees 0 to 360, at and under which the min scale applies | `45` |
| `cutViewDistanceFovMinAngleScale` | Scale of an object of its own at that angle and under, 0 or more | `1` |
| `cutViewDistanceFovMaxAngle` | Degrees 0 to 360, at and over which the max scale applies | `90` |
| `cutViewDistanceFovMaxAngleScale` | Scale at that angle and over, 0 or more | `1` |
| `cutLodBiasFollowsUpscale` | Upscaled threshold follows display over render width | `true` |
| `cutLodBiasOffset` | Bias offset, powers of two | `0` |
| `cutLodBiasMin` | Bias floor, powers of two | `-2` |
| `cutEdgeScaleBudgetMs` | GPU ms for the main view's cut and raster; over it the screen error is coarsened; 0 or less, none | `0` |
| `cutEdgeScaleMinPercent` | Lowest screen error scale the budget takes, percent, 1 to 100 | `30` |
| `cutMaxNodes` | Most nodes one pass opens, whole 1 to 2³¹ − 1 | `2097152` |
| `cutMaxCandidateClusters` | Most candidate clusters one cut lists, whole 1 to 2³¹ − 1 | `16777216` |
| `cutMaxVisibleClusters` | Most clusters one cut draws, whole 1 to 2³¹ − 1 | `4194304` |
