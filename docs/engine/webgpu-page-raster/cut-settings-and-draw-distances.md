# Cut settings and draw distances

An object that names a draw distance (`objectSettings.drawDistance`,
[COMPILER.md](../../compiler/the-partitions-grids.md#object-settings)) is tested first, before its
frustum test, from the main view's eye, on the sphere of its root's bounds: half the box's diagonal
about its centre, at the placement's pose, held to the half diagonal of the box the pose makes of the
root's box (an uneven scale never makes the sphere larger than the box itself). The object is culled
while the sphere lies wholly nearer than its `min` or wholly farther than its `max`; with
`cutDistanceCullToSphereEdge` off, while its centre does. One instance of an instanced mesh
(`perInstance`) is always tested at its centre. Two scales multiply the distances:

- an object of its own takes `cutViewDistanceScale` (times `cutViewDistanceSecondaryScale` where
  `cutViewDistanceApplySecondaryScale` is on) and the scale of the view's horizontal field of view:
  `cutViewDistanceFovMinAngleScale` at `cutViewDistanceFovMinAngle` and under,
  `cutViewDistanceFovMaxAngleScale` at `cutViewDistanceFovMaxAngle` and over, blended linearly between,
  an orthographic view counting as 0 degrees (45 and 90 degrees, both scales 1: no change);
- an instance takes the first scale alone.

The switch `cutDrawDistanceCulling` turns the cull off for instances alone; an object of its own is
always culled by its distances, so a scene that names none pays nothing for it. A group of 64
placements of the placement tree holds the nearest and the farthest distance of its placements and is
culled only where none of them can be drawn: its box's centre distance, nearer or farther by twice the
box's half diagonal (the half diagonal for a point of the box, and again for the sphere of a placement
about it), lies outside them, the nearest taken at the smaller of the two scales and the farthest at
the larger. A distant group costs its placements nothing; a group with a placement that names no
distance is never culled by it, nor is any while `cutDrawDistanceCulling` is off (some of its
placements may be instances), and a cut in one pass (above) tests its placements alone. The post pass
tests none again: what it holds passed in the main pass, the eye unchanged.

The sun's shadows and the rays' scene take the distances from the same eye. An object out of its
distances casts no shadow in the virtual shadow maps, tested at the centre of its bounds with
`cutViewDistanceScale` alone (the casters read no field of view); the instances' share of the test
follows `cutDrawDistanceCulling`. The bounce and reflection rays do not meet it (their scene is the
objects' proxies): an object of its own is judged on its farthest distance alone, at the sphere and by
its own scale, an instance on both distances at its centre and by the instances' scale, none while
`cutDrawDistanceCulling` is off. No fade over a travel distance is provided: every object drawn here
is a cluster DAG, which has none. The reference's fifth field of view setting, which scales the HLOD's
own draw distances, has no counterpart: the HLOD levels stream as cells chosen by their grids' loading
ranges, never by a pair of distances.

Every setting is the reference's by default, a world option by its field, held over the quality
preset (only `cutViewDistanceScale` is written by a level, the view distance's), changed later by
`world.cut` from the next frame (`packages/sdk-core/src/contracts/cutOptions.ts`); a value a setting
does not take is refused. The cut's GPU time budget is off (0), its lowest scale 30 %, the secondary
scale of the draw distances off at 1, and the field of view's scales 1 from 45 to 90 degrees:

```ts
const world = createWorld(canvas, { cutTwoPassOcclusion: false })
world.cut = { cutLodBiasFollowsUpscale: false, cutLodBiasMin: -1 }
world.cut = { cutTwoPassOcclusion: null } // back to the preset's, here the default
```

The view distance's levels write `cutViewDistanceScale`: 0.4 at `smooth`, 0.6 at `balanced`, 0.8 at
`fine`; `max` writes nothing (1) and `cinematic` writes 10. `pixelError` and the cut's other settings
stay at their defaults at every level.

```ts
const world = createWorld(canvas, { quality: { preset: 'balanced' } })
// cutViewDistanceScale is 0.6: every draw distance is 60 % of what the scene names
world.cut = { cutViewDistanceScale: 1 } // the page's value holds over the preset
world.cut = { cutDrawDistanceCulling: false } // every instance drawn at every distance
world.cut = { cutViewDistanceFovMaxAngleScale: 0.5 } // an object of its own: halved at 90 degrees and over
```

**The draw distances' second scale.** An object's draw distance is scaled by `cutViewDistanceScale`
(default 1) and, when `cutViewDistanceApplySecondaryScale` is `true`, also by
`cutViewDistanceSecondaryScale` (default 1): the product is what the cut, the rays' scene and the
shadow casters read (`viewDistanceFactor`); an object the cut drops by its distance casts no shadow
either. The second scale is for a feature that opts in, without touching what the quality level wrote:
`world.cut = { cutViewDistanceApplySecondaryScale: true, cutViewDistanceSecondaryScale: 0.5 }` halves
every draw distance. The scale of the field of view multiplies the draw distances of the objects of
their own beside them, in the cut and in the rays' scene.

**A GPU time budget for the cut.** `cutEdgeScaleBudgetMs` gives the main view's cut and its raster
(the passes that build its visibility buffer: selection, the binning of its visible clusters, Hi-Z and
raster) a time in milliseconds. It is one more budget of the dynamic resolution's heuristic
([Dynamic resolution](../temporal-antialiasing.md#dynamic-resolution),
`frame/scale/dynamicResolution.ts`), so it works where the render scale is `'auto'` (a number fixes the
render scale and the budget does nothing): the same history, the same change period, the same resets
(a new display, another refresh, other bounds or a GPU timer gone silent forget both budgets
together), the cut's time read from the same sample the render scale's is. The cut's threshold is
`pixelError / fraction`, the fraction between `cutEdgeScaleMinPercent` / 100 and 1 and the lesser of
it and the streaming quality scale, for the main view's cut only: the budget measures that view's
time, so a view drawn beside it (a minimap, a mirror, a probe) keeps the host's threshold. What
differs from the render scale's fit is the model: the cut's time scales with the fraction itself, not
its square (each image suggests `fraction · budget · 0.95 / time`), 5 % of the budget is left free, a
change under 1 % is none, and a history all over the budget moves the edge scale at the next change
period, where the render scale moves at once and takes the edge scale's change with it. Each time is
paired with the edge fraction in force when it is read; a time of 0 asks for the most a fraction may
be, and a sample that holds none of those passes is skipped. Off (0, the default), no time of those
passes is summed and nothing is kept.

```ts
const world = createWorld(canvas, { renderScale: 'auto', cutEdgeScaleBudgetMs: 6 })
// over 6 ms the main view's pixels per edge grow, up to 1 / 0.3 times pixelError, and come back under it
world.cut = { cutEdgeScaleMinPercent: 50 } // never coarser than 2 × pixelError
world.cut = { cutEdgeScaleBudgetMs: null } // no budget again: the threshold is the host's
```

| Field | Meaning | Default |
| --- | --- | --- |
| `cutTwoPassOcclusion` | Each view's cut runs its two passes; `false`, one pass that occludes nothing | `true` |
| `cutOcclusionCulling` | The cut tests its boxes against the depth pyramids at all | `true` |
| `cutFrustumCulling` | The cut rejects the boxes outside the frustum | `true` |
| `cutMinLodCulling` | The cut prunes a leaf whose least own error still shows at its nearest | `true` |
| `cutDrawDistanceCulling` | The cut culls an instance of an instanced mesh (`perInstance`) outside the draw distances it names; `false`, none is culled; an object of its own is always culled by them | `true` |
| `cutDistanceCullToSphereEdge` | An object's draw distance is measured to the edge of the sphere of its bounds; `false`, to its centre | `true` |
| `cutViewDistanceScale` | The scale every draw distance, min and max, is multiplied by, a finite number of at least 0 | `1` |
| `cutViewDistanceApplySecondaryScale` | Whether `cutViewDistanceSecondaryScale` multiplies the draw distances | `false` |
| `cutViewDistanceSecondaryScale` | A second scale of the draw distances, for a feature or a mode to opt in to: it multiplies `cutViewDistanceScale` once the switch above is on; 0 or more | `1` |
| `cutViewDistanceFovMinAngle` | The horizontal field of view, in degrees from 0 to 360, at and under which the draw distances of an object of its own take `cutViewDistanceFovMinAngleScale` | `45` |
| `cutViewDistanceFovMinAngleScale` | The scale the draw distances of an object of its own take at that angle and under, 0 or more | `1` |
| `cutViewDistanceFovMaxAngle` | The horizontal field of view, in degrees from 0 to 360, at and over which the draw distances of an object of its own take `cutViewDistanceFovMaxAngleScale` | `90` |
| `cutViewDistanceFovMaxAngleScale` | The scale the draw distances of an object of its own take at that angle and over, 0 or more; blended linearly with the first between the two angles | `1` |
| `cutLodBiasFollowsUpscale` | An upscaled image's threshold follows the display over the render width | `true` |
| `cutLodBiasOffset` | The bias's offset, in powers of two, any finite number | `0` |
| `cutLodBiasMin` | The bias's floor, in powers of two, any finite number | `-2` |
| `cutEdgeScaleBudgetMs` | GPU time, in ms, the main view's cut and its raster may take; over it that cut's screen error is coarsened; 0 or less, no budget | `0` |
| `cutEdgeScaleMinPercent` | The lowest scale of the screen error the budget takes it to, in percent, from 1 to 100 | `30` |
| `cutMaxNodes` | Most nodes one pass opens, a whole number from 1 to 2³¹ − 1 | `2097152` |
| `cutMaxCandidateClusters` | Most candidate clusters one cut lists, a whole number from 1 to 2³¹ − 1 | `16777216` |
| `cutMaxVisibleClusters` | Most clusters one cut draws, a whole number from 1 to 2³¹ − 1 | `4194304` |
