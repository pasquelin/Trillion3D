# Translucency global illumination volume

See-through surfaces read indirect light from a view-fitted grid of cells with log-spaced depth
slices, traced each image (distance field, surface cache, radiance cache), filtered, blended with
the previous image. Needs the screen probes' levels that cast probes; below them, or off, a
surface takes the sky light irradiance alone. Settings
(`packages/sdk-core/src/contracts/translucencyGiOptions.ts`), distances in metres:

| Setting | Meaning | Default |
| - | - | - |
| `translucencyGi` | Volume is made | `true` |
| `translucencyGiTraceFromVolume` | Cells march the distance field first | `true` |
| `translucencyGiHardwareRayTracing` | With march on, cast through scene triangles | `true` |
| `translucencyGiRadianceCache` | Cells read the radiance cache | `true` |
| `translucencyGiRadianceCacheClipmapBias` | Cascades coarser than the covering one | `3` |
| `translucencyGiGridPixelSize` | Pixels a cell side | `32` |
| `translucencyGiGridDistributionLogZScale` | Per metre, log scale | `1` |
| `translucencyGiGridDistributionLogZOffset` | Log offset | `1` |
| `translucencyGiGridDistributionZScale` | Slices per depth doubling | `4` |
| `translucencyGiEndDistance` | Depth of last slice | `80` |
| `translucencyGiTracingResolution` | Cones a cell side | `3` |
| `translucencyGiMaxRayIntensity` | Brightest cone, exposure units | `20` |
| `translucencyGiGridCenterOffsetFromDepthBuffer` | Cells a point behind depth is held in front; <0 none | `0.5` |
| `translucencyGiOffsetThresholdToAcceptDepthBufferOffset` | Cells; nearest behind depth moved forward from | `1` |
| `translucencyGiSpatialFilter` | Filter along three axes | `true` |
| `translucencyGiSpatialFilterSampleCount` | Cells either side | `3` |
| `translucencyGiSpatialFilterStandardDeviation` | Cells, Gaussian | `5` |
| `translucencyGiTemporalReprojection` | Blend with previous image | `true` |
| `translucencyGiTemporalJitter` | Turn trace point and directions per image | `true` |
| `translucencyGiTemporalHistoryWeight` | History share kept | `0.9` |
| `translucencyGiTemporalMaxRayDirections` | Turns before directions repeat | `8` |

```js
const world = createWorld('viewer', { translucencyGiGridPixelSize: 16 }) // finer cells
world.translucencyGi = { translucencyGiEndDistance: 150 } // a deeper grid, from the next frame
world.translucencyGi = { translucencyGiTemporalHistoryWeight: null } // given back to its default
world.translucencyGi = { translucencyGiHardwareRayTracing: false } // keep marching the distance field
world.translucencyGi = { translucencyGi: false } // off: no pass, no texture
```

Explorer: `explorer.setTranslucencyGi('translucencyGiEndDistance', 120)`; agent:
`trillion3d_set_translucency_gi`.
