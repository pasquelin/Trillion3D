# Depth pyramid and occlusion settings

`world.hiz`: depth pyramid settings, each also a `createWorld` option. A write names changed
settings, `null` restores a default; a value of another kind is refused by name.

## Trace and light grid

- `hizTrace` (`'reference'`): reflection trace walks half-resolution closest opaque depth to full
  resolution. `'planes'` reads each pixel as a plane (keeps grazing hits).
- `hizFoldTransparents` (`false`): `true` adds the nearest transparent surface (rays stop at glass).
- `hizTransparentTest` (`'finer'`): up to 16 texels a side of a fine level; `'reference'`: 4 texels
  a side of the lowest level holding the cluster. `'finer'` rejects more.
- `hizFullResDepth` (`true`): screen probes' `'reference'` walk goes to full resolution; `false`
  stops at half. Reflection walk always goes down.
- `lightGridHizCull` (`true`): empties cells behind their column's farthest depth; `false` lists
  every cell lights reach.
- `lightGridLinkedLists` (`true`): cell lists are link chains from a shared pool (short of links,
  a cell keeps its first lights). `false`: own `lightGridMaxCulledLightsPerCell` words per cell.
- `lightGridMaxCulledLightsPerCell` (`32`): entries per cell, 1 to 1024; extra lights dropped, one
  console warning.

```js
const world = createWorld('viewer', { hizTrace: 'planes', hizTransparentTest: 'reference' })
world.hiz = { hizTrace: null, hizFoldTransparents: true } // the default trace, glass in the pyramid
world.hiz = { hizFullResDepth: false, lightGridHizCull: false } // half-resolution probe walk, no cull
world.hiz = { lightGridLinkedLists: false, lightGridMaxCulledLightsPerCell: 64 } // 64 words of its own a cell
```

## Light grid debug view

`lightGridDebug` (`0`, off) draws the light grid over the image (count in each cell, grey borders);
needs lit lights.

- `1`: blue (no light) to red (`lightGridDebugMaxThreshold` lights, `8`, 1 to 1024) by light count
  in the pixel's depth cell.
- `2`: greatest count over the column's slices but the last; `3`: over all slices.
- `lightGridDebugSlice` (`-1`): above `-1` shows only that slice (capped at the last).

```js
world.hiz = { lightGridDebug: 1 } // the lights in the cell of each pixel
world.hiz = { lightGridDebug: 3, lightGridDebugMaxThreshold: 16 } // the greatest count of a column, red at 16
world.hiz = { lightGridDebug: 1, lightGridDebugSlice: 12 } // only the twelfth slice
```

## Primed pyramid

`hizPrime` (`'off'`): builds a primed pyramid before the cut tests, from a coarse draw of objects
with `farField` (`object.farField = true`, default `false`; saved scenes keep `true`).

- `'whenMissing'`: when the view has no previous pyramid (first, resize, camera cut); `'always'`:
  every image.
- Draw size = image size shifted right by `1 + hizPrimeSizeBias` (`2`, integer 0 to 30); depth pushed from the eye
  by `hizPrimeDepthBias` metres (`1.5`); clusters cut at `hizPrimeErrorScale` (`32`) times pixel
  error.
- `hizPrimeFarFieldOnly` (`true`): flagged objects only; `false`: the whole cut.

No flagged object: nothing drawn. The image is unchanged.

```js
const world = createWorld('viewer', { hizPrime: 'whenMissing' })
mountains.farField = true // this object is drawn into the primed pyramid
world.hiz = { hizPrime: 'always', hizPrimeDepthBias: 3 } // every image, pushed away by 3 metres
world.hiz = { hizPrime: 'always', hizPrimeSizeBias: 3, hizPrimeErrorScale: 16 } // a smaller draw, finer error
world.hiz = { hizPrimeFarFieldOnly: false } // the whole cut is primed, not the flagged objects
world.hiz = { hizPrime: null } // back to the default, 'off'
```

## Occlusion culling

`hzbOcclusion` (`0`): main view omits objects its depth hides. At `1` (`2` forced) each image walks
every object's projected world box against the pyramid's farthest depth (as
`hizTransparentTest: 'reference'`). Verdicts arrive a few images late; a hidden object leaves the
next cuts until a test finds it in front.

- No box, outside the view, or within `hzbOcclusionNeverTestDistance` metres (`0`) of the eye: never
  rejected; shadow maps never see the verdict.
- `hzbOcclusionExpandAmount` (`0`) metres and `hzbOcclusionExpandScreenSpace` (`0`) pixels grow
  every tested box.
- `hzbOcclusionExpandNewlyAmount` and `hzbOcclusionExpandNewlyScreenSpace` (`0`) also grow an
  object untested for `hzbOcclusionFramesNotTestedToExpand` (`5`) images, for its next
  `hzbOcclusionFramesToExpandNewly` (`2`) tested images.

`occlusionQueries` (off): GPU occlusion queries, while `hzbOcclusion` is `0`. World boxes are drawn
sixteen to a query against the depth; counts arrive late; an object whose group passed no sample
leaves the next cuts until a group passes one. No box, or a box reaching the eye's plane: never
hidden; at most 65536 objects queried.

```js
const world = createWorld('viewer', { occlusionQueries: true })
world.hiz = { occlusionQueries: null } // back to the default, off
```

`downsampledOcclusionQueries` (off): queries test a depth copy halved per side first, each texel
the farthest of four; an object is hidden only where the whole texel square hides it.

```js
const world = createWorld('viewer', { occlusionQueries: true, downsampledOcclusionQueries: true })
world.hiz = { downsampledOcclusionQueries: null } // back to the default, off
```

```js
const world = createWorld('viewer', { hzbOcclusion: 1 })
world.hiz = { hzbOcclusionExpandScreenSpace: 8, hzbOcclusionNeverTestDistance: 2 } // grown by 8 pixels, none tested within 2 m
world.hiz = { hzbOcclusion: null } // back to the default, none
```
