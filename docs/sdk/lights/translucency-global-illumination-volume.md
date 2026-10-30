# Translucency global illumination volume

The indirect light of the see-through surfaces (blend, water, transmission) is held in a grid fitted to the view: a cell is
`translucencyGiGridPixelSize` pixels a side across the image, and its depth slices follow a logarithm of the distance from the camera out
to `translucencyGiEndDistance`. Each image every cell traces `translucencyGiTracingResolution` squared cones (the global distance field
marched, the surface cache read at the hit, the radiance cache read for what the march leaves), the light is filtered along the three
axes, projected on two-band harmonics and blended with the volume of the image before; a surface reads it with one filtered fetch,
instead of gathering the world's probes in each fragment. The cells read the world's radiance cache, `translucencyGiRadianceCacheClipmapBias`
cascades coarser than the one covering them. The grid needs the screen probes' levels that cast probes; below them, and with the setting
off, a surface takes the sky light irradiance alone. Settings (`packages/sdk-core/src/contracts/translucencyGiOptions.ts`), distances in metres:

| Setting | Meaning | Default |
| --- | --- | --- |
| `translucencyGi` | Whether the volume is made | `true` |
| `translucencyGiTraceFromVolume` | The cells march the distance field before reading the cache | `true` |
| `translucencyGiHardwareRayTracing` | With the march on, cast the cones through the scene's triangles | `true` |
| `translucencyGiRadianceCache` | The cells read the radiance cache | `true` |
| `translucencyGiRadianceCacheClipmapBias` | Cascades coarser than the covering one for reads and marks | `3` |
| `translucencyGiGridPixelSize` | Pixels a side of a cell | `32` |
| `translucencyGiGridDistributionLogZScale` | Per metre, the slices' logarithm scale | `1` |
| `translucencyGiGridDistributionLogZOffset` | The logarithm's offset | `1` |
| `translucencyGiGridDistributionZScale` | Slices per doubling of the depth | `4` |
| `translucencyGiEndDistance` | Metres, the depth of the last slice | `80` |
| `translucencyGiTracingResolution` | Cones a cell traces along a side | `3` |
| `translucencyGiMaxRayIntensity` | The brightest a cone may be, in exposure units | `20` |
| `translucencyGiGridCenterOffsetFromDepthBuffer` | Cells a trace point behind the depth is held in front of it; <0 none | `0.5` |
| `translucencyGiOffsetThresholdToAcceptDepthBufferOffset` | Cells, the nearest behind the depth a point is moved forward from | `1` |
| `translucencyGiSpatialFilter` | Filter the cones' light along the three axes | `true` |
| `translucencyGiSpatialFilterSampleCount` | Cells either side of the filter centre | `3` |
| `translucencyGiSpatialFilterStandardDeviation` | Cells, the filter's Gaussian | `5` |
| `translucencyGiTemporalReprojection` | Blend with the image before, reprojected | `true` |
| `translucencyGiTemporalJitter` | Turn the trace point and directions each image | `true` |
| `translucencyGiTemporalHistoryWeight` | Share of the history kept | `0.9` |
| `translucencyGiTemporalMaxRayDirections` | Turns the directions take before they come round | `8` |

```js
const world = createWorld('viewer', { translucencyGiGridPixelSize: 16 }) // finer cells
world.translucencyGi = { translucencyGiEndDistance: 150 } // a deeper grid, from the next frame
world.translucencyGi = { translucencyGiTemporalHistoryWeight: null } // given back to its default
world.translucencyGi = { translucencyGiHardwareRayTracing: false } // keep marching the distance field
world.translucencyGi = { translucencyGi: false } // off: no pass, no texture
```

The explorer takes the same by field (`explorer.setTranslucencyGi('translucencyGiEndDistance', 120)`), and an agent through
`trillion3d_set_translucency_gi`.
