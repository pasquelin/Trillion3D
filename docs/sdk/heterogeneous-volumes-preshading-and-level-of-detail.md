# Heterogeneous volumes: preshading and level of detail
`heterogeneousVolumesPreshading` (`false`) bakes a volume's material into three 3D textures (extinction, albedo, emission) before the march, which then reads the textures instead of evaluating the material at each step. `heterogeneousVolumesCLOD` (`true`) makes a volume far from the view coarser: its lighting cache, occlusion and baked grid have fewer voxels and its march steps are longer.

| Setting | Default | Meaning |
| --- | --- | --- |
| `heterogeneousVolumesPreshadingMipLevel` | `0` | level of the baked textures the march reads; the levels are filtered from the first, which the reference never does |
| `heterogeneousVolumesPreshadingPixelFormat` | `2` | `0` keeps the red channel alone, `1` to `3` the colour channels |
| `heterogeneousVolumesPreshadingCLOD` | `1` | baked grid size: `0` the volume's, `1` over the level of detail's factor, `2` the lighting cache's |
| `heterogeneousVolumesCLODBias` | `0` | above `0` coarser, below `0` sharper |
| `heterogeneousVolumesVolumeResolutionX` / `Y` / `Z` | `0` | above `0`, replaces that axis of the resolution the bake, the lighting cache and the occlusion use |
| `heterogeneousVolumesAmbientOcclusionRayCountX` / `Y` | `4` | occlusion rays a side, `1` to `8` |

```js
// Baked volumes, sharper than the default level of detail, lit at 64 voxels on every axis.
const world = createWorld('viewer', {
  heterogeneousVolumesPreshading: true,
  heterogeneousVolumesCLODBias: -1,
  heterogeneousVolumesVolumeResolutionX: 64,
  heterogeneousVolumesVolumeResolutionY: 64,
  heterogeneousVolumesVolumeResolutionZ: 64,
})
```
