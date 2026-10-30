# Depth pyramid and occlusion settings

`world.hiz` holds the depth pyramid's settings, each also a `createWorld` option. A write names the
settings it changes, `null` one's default; a value of another kind is refused by name.

## Trace and light grid

- `hizTrace` (`'reference'`): the reflections' trace walks the closest opaque depth of each
  half-resolution texel, mip by mip, down to the full-resolution depth, as the reference's does.
  `'planes'` reads each pixel as a plane, which keeps a hit on a grazing surface that the centre
  alone passes over.
- `hizFoldTransparents` (`false`): the trace layers hold the opaque depth alone; `true`, the nearest
  transparent surface of each pixel too, so a ray stops at glass.
- `hizTransparentTest` (`'finer'`): a transparent cluster is tested over up to sixteen texels a side
  of a fine level; `'reference'`: over four texels a side of the lowest level that holds it. The
  image is the same; `'finer'` rejects more clusters.
- `hizFullResDepth` (`true`): the screen probes' `'reference'` walk goes down to the
  full-resolution depth; `false` stops at the half-resolution level, a little less exact and
  cheaper. The reflections' walk always goes down.
- `lightGridHizCull` (`true`): the light grid leaves empty the cells behind the farthest depth of
  their column of the image, read from the pyramid the image built; `false` lists every cell the
  lights reach.
- `lightGridLinkedLists` (`true`): the cells' lists are chains of links taken from one pool shared
  by the whole grid, and when links run short each cell keeps the first lights of its list; `false`:
  each cell has its own `lightGridMaxCulledLightsPerCell` words and keeps its first lights up to
  them.
- `lightGridMaxCulledLightsPerCell` (`32`): the light entries the view's light grid holds per cell,
  from 1 to 1024; the pool holds that many for each cell; the lights asked past it are dropped, with
  one console warning.

The cut's occlusion reads the culling layer, which no setting changes.

```js
const world = createWorld('viewer', { hizTrace: 'planes' })
world.hiz = { hizTrace: null, hizFoldTransparents: true } // the default trace, glass in the pyramid
world.hiz = { hizFullResDepth: false, lightGridHizCull: false } // half-resolution probe walk, no cull
world.hiz = { lightGridLinkedLists: false, lightGridMaxCulledLightsPerCell: 64 } // 64 words of its own a cell
```

## Light grid debug view

`lightGridDebug` (`0`, off) draws the light grid over the image, the count written in the middle of
each cell and the borders drawn in grey. It needs lit lights in the scene.

- `1` colours each cell from blue (no light) to red (`lightGridDebugMaxThreshold` lights, `8` by
  default, from 1 to 1024) by the number of lights in the cell of each pixel's depth.
- `2` does so by the greatest number over the slices of its column but the last (the last slice's
  culling is too wide to mean much); `3` over all of them.
- `lightGridDebugSlice` (`-1`) above `-1` shows the one slice of that index (read no higher than the
  last) whatever the view.

```js
world.hiz = { lightGridDebug: 1 } // the lights in the cell of each pixel
world.hiz = { lightGridDebug: 3, lightGridDebugMaxThreshold: 16 } // the greatest count of a column, red at 16
world.hiz = { lightGridDebug: 1, lightGridDebugSlice: 12 } // only the twelfth slice
```

## Primed pyramid

`hizPrime` (`'off'`) builds, before a view's cut tests anything, a primed pyramid from a small,
coarse draw of the objects that set `farField` (`object.farField = true`, `false` by default; a
saved scene keeps it when `true`), for the cut's main pass to test against.

- `'whenMissing'`: for an image whose view has no pyramid of the image before (its first, one after
  a resize, one after a cut of the camera); `'always'`: for every image.
- The draw is the image's size shifted right by `1 + hizPrimeSizeBias` (`2`: an eighth), its depth
  pushed away from the eye by `hizPrimeDepthBias` metres (`1.5`), its clusters cut at
  `hizPrimeErrorScale` (`32`) times the image's pixel error.
- `hizPrimeFarFieldOnly` (`true`) draws the flagged objects alone, `false` the whole cut.

With no object flagged it draws nothing and costs nothing. The image is the same: the primed pyramid
only lets the main pass skip what it hides, and the post pass judges again what it hid.

```js
const world = createWorld('viewer', { hizPrime: 'whenMissing' })
mountains.farField = true // this object is drawn into the primed pyramid
world.hiz = { hizPrime: 'always', hizPrimeDepthBias: 3 } // every image, pushed away by 3 metres
world.hiz = { hizPrime: null } // back to the default, 'off'
```

## Occlusion culling

`hzbOcclusion` (`0`) makes the main view leave out the objects the depth it drew hides. At `1` (or
`2`, forced) the world box of every object is projected each image and walked against the farthest
depth of the pyramid, with the walk the transparent clusters are tested with under
`hizTransparentTest: 'reference'` (the lowest level that holds the box in four texels a side). The
verdicts are copied for the CPU and come back a few images late; an object found behind the depth is
left out of the next images' cut, in front again when a test finds it so.

- An object with no box, outside the view or within `hzbOcclusionNeverTestDistance` metres (`0`) of
  the eye is never rejected, and the shadow maps never see the verdict.
- `hzbOcclusionExpandAmount` (`0`) metres and `hzbOcclusionExpandScreenSpace` (`0`) pixels grow
  every tested box, which hides fewer objects and shows fewer of them late.
- `hzbOcclusionExpandNewlyAmount` and `hzbOcclusionExpandNewlyScreenSpace` (`0`) grow, beside them,
  an object not tested for `hzbOcclusionFramesNotTestedToExpand` (`5`) images, for the next
  `hzbOcclusionFramesToExpandNewly` (`2`) images it is tested in.

`occlusionQueries` (off) asks the same of the GPU's own occlusion queries instead, while
`hzbOcclusion` is `0`: the world boxes of the objects are drawn sixteen to a query against the depth
the image drew (depth tested, nothing written), the counts come back a few images late, and an
object whose group let no sample through is left out of the next images' cut until a later group
lets one through. An object with no box, or a box that reaches the eye's plane, is never hidden; at
most 65536 objects are queried.

```js
const world = createWorld('viewer', { occlusionQueries: true })
world.hiz = { occlusionQueries: null } // back to the default, off
```

`downsampledOcclusionQueries` (off) makes those queries test against a smaller copy of the depth:
the image's depth is reduced to half its size on each side first, each texel keeping the farthest of
the four it covers, and the boxes are drawn at that size. An object is then hidden only where the
whole square of texels hides it: fewer objects are hidden and the queries count fewer samples.

```js
const world = createWorld('viewer', { occlusionQueries: true, downsampledOcclusionQueries: true })
world.hiz = { downsampledOcclusionQueries: null } // back to the default, off
```

```js
const world = createWorld('viewer', { hzbOcclusion: 1 })
world.hiz = { hzbOcclusionExpandScreenSpace: 8, hzbOcclusionNeverTestDistance: 2 } // grown by 8 pixels, none tested within 2 m
world.hiz = { hzbOcclusion: null } // back to the default, none
```
