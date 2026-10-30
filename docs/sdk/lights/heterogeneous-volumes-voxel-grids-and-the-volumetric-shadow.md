# Heterogeneous volumes: voxel grids and the volumetric shadow map

`world.heterogeneousVolumeRendering` holds the settings. Volumes can be shadowed through voxel grids:
a frustum grid and an axis-aligned one over the volumes' bounds, each a top level of cells holding
bottom-level voxels (`heterogeneousVolumesBottomLevelGridResolution`, 1 to 4, 4; indirection grid
`heterogeneousVolumesIndirectionGridResolution` 4, while `heterogeneousVolumesIndirectionGrid` is on).
`heterogeneousVolumesMajorantGrid` (on) holds each top cell's greatest extinction;
`heterogeneousVolumesMajorantGridMax` (off) adds the chain down to one cell;
`heterogeneousVolumesTopLevelBitmask` (off) marks occupied cells. Shadow = list of samples a texel
(`heterogeneousVolumesShadowsMaxSampleCount` 8, within `heterogeneousVolumesShadowsRelativeErrorThreshold`
0.05 and `...AbsoluteErrorThreshold` 0, compressed while `heterogeneousVolumesShadowsUseAvsmCompression`
is on). `heterogeneousVolumesShadowsPipeline`: 0 (default) shades live; 1 builds the grids. Sparse
voxels (`heterogeneousVolumesSparseVoxel`, off, with `...GenerationMipBias`, `...PerTileCulling`,
`...Refinement`) are coarse-level cells where a volume has density.

`heterogeneousVolumesShadowsType`: 1 (default) beer map (first and last place with extinction per
texel and transmittance at both); 0 adaptive volumetric shadow map (up to
`heterogeneousVolumesShadowsMaxSampleCount` samples a texel, each volume's list combined with those
before it, compressed in two levels), read by the lit passes instead. A resolution too big for the
device's storage buffer is halved. `heterogeneousVolumesHardwareRayTracing` (off), with
`heterogeneousVolumesPreshading` on, makes the march visit only the sparse voxels' spans a ray meets
(`...SparseVoxelGenerationMipBias`, `...SparseVoxelRefinement`; box hierarchy walked front to back by
a compute pass).

```js
world.heterogeneousVolumeRendering = {
  heterogeneousVolumesShadows: true,
  heterogeneousVolumesShadowsType: 0, // adaptive volumetric shadow map
  heterogeneousVolumesPreshading: true,
  heterogeneousVolumesHardwareRayTracing: true, // march only the voxels the ray meets
  heterogeneousVolumesSparseVoxelRefinement: true,
}
```

```js
world.heterogeneousVolumeRendering = {
  heterogeneousVolumesShadows: true,
  heterogeneousVolumesShadowsPipeline: 1,
  heterogeneousVolumesFrustumGridShadingRate: 2, // voxels two pixels wide in the view
  heterogeneousVolumesMinimumVoxelSizeInFrustum: 0.05, // metres
  heterogeneousVolumesShadowsMaxSampleCount: 16,
}
```

Pipeline 1 builds the grids in every image's shadows phase. Volumes are rasterized: each top cell a
volume's box meets gets the voxel its distance and `heterogeneousVolumesShadowsShadingRate` (1 pixel
in view, `...ShadowsOutOfFrustumShadingRate` 2 out of it) ask. Bottom-level and indirection cells come
from pools: `heterogeneousVolumesOrthoGridMaxBottomLevelMemoryInMegabytes` (128),
`...FrustumGridMaxBottomLevelMemoryInMegabytes` (128; shadows do not build the frustum grid). A bottom
region of near-constant extinction (relative error under
`heterogeneousVolumesBottomLevelGridHomogeneousAggregationThreshold` 0.001 and under four empty
voxels) is one voxel while `heterogeneousVolumesBottomLevelGridHomogeneousAggregation` is on
(default). A full pool leaves cells empty; a three-voxel bottom level takes two (Morton order).
`heterogeneousVolumesShadowsLightDirectional`, `...Point`, `...Spot`, `...Rect` (all on) select which
light kinds cast a volumetric shadow; each light's map is the beer map, or the adaptive one with
`heterogeneousVolumesShadowsType` 0.

`heterogeneousVolumesDebug` (0, off) shows the transmittance through the grids (opacity in alpha, the
way's gathered data in colour):

- 1 walks the ortho and frustum grids cell by cell;
- 2 to 5 follow the ray by samples (voxel steps, cell majorant per step, greatest grid majorant,
  majorant-grid cells in turn);
- 6 to 9 random-walk tracking (spectral weighted delta, ratio, spectral ratio, majorant-grid cells in
  turn by delta tracking), one walk a pixel; noisy, accumulated by the temporal pass.

`world.diagnostic.mode` values `'heterogeneous-volumes-dda-marching'`, `'...-sample-marching'`,
`'...-sample-majorant'`, `'...-sample-max-majorant'`, `'...-sample-majorant-dda'`,
`'...-delta-tracking'`, `'...-ratio-tracking'`, `'...-spectral-ratio-tracking'`,
`'...-tracking-majorant-dda'` are modes 1 to 9.

```js
// The shadows traced through the grids, and the grids seen by the walk of a ray through the majorant grid, cell by cell.
world.heterogeneousVolumeRendering = {
  heterogeneousVolumesShadows: true,
  heterogeneousVolumesShadowsPipeline: 1,
  heterogeneousVolumesOrthoGridMaxBottomLevelMemoryInMegabytes: 256,
  heterogeneousVolumesShadowsLightPoint: false, // only the sun casts a volumetric shadow
  heterogeneousVolumesBottomLevelGridHomogeneousAggregationThreshold: 0.01,
}
world.diagnostic.mode = 'heterogeneous-volumes-sample-majorant-dda'
```
