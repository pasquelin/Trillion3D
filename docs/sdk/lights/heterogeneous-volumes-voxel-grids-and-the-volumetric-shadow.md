# Heterogeneous volumes: voxel grids and the volumetric shadow map

`world.heterogeneousVolumeRendering` holds the settings of the heterogeneous volumes. Besides the live shading, the volumes can be
shadowed through voxel grids: a grid cut in the view's frustum and an axis-aligned one over the volumes' bounds, each a top level of
cells holding bottom-level voxels (`heterogeneousVolumesBottomLevelGridResolution`, 1 to 4, 4 by default; an indirection grid of
`heterogeneousVolumesIndirectionGridResolution`, 4, while `heterogeneousVolumesIndirectionGrid` is on). A grid of the greatest extinction
of each top-level cell (`heterogeneousVolumesMajorantGrid`, on; `heterogeneousVolumesMajorantGridMax`, off, adds the chain down to one
cell) and a bitmask of the occupied cells (`heterogeneousVolumesTopLevelBitmask`, off) speed up the tracking. The shadow of a light or of
the camera is then a list of samples a texel (`heterogeneousVolumesShadowsMaxSampleCount`, 8, kept within
`heterogeneousVolumesShadowsRelativeErrorThreshold` 0.05 and `...AbsoluteErrorThreshold` 0, compressed while
`heterogeneousVolumesShadowsUseAvsmCompression` is on). `heterogeneousVolumesShadowsPipeline` picks the way: 0, the default, shades the
volumes live; 1 builds the grids. Sparse voxels (`heterogeneousVolumesSparseVoxel`, off, with `...GenerationMipBias`, `...PerTileCulling`
and `...Refinement`) are the cells of a coarse level where a volume has density.

`heterogeneousVolumesShadowsType` picks the map the volumes' cast shadows are kept in: 1, the default, the beer map (the first and last
place with extinction of each texel and the transmittance at both); 0 the adaptive volumetric shadow map, a list of up to
`heterogeneousVolumesShadowsMaxSampleCount` samples a texel (each volume's list combined with the volumes' before it, then compressed in
two levels), read by the lit passes in place of the beer map. A resolution that would not fit the device's storage buffer is halved.
`heterogeneousVolumesHardwareRayTracing` (off), with `heterogeneousVolumesPreshading` on, makes the march visit only the spans of the
sparse voxels a ray meets: the voxels (`...SparseVoxelGenerationMipBias`, `...SparseVoxelRefinement`) are cut out of the baked extinction,
a hierarchy of boxes is built over them and each pixel's ray walks it, front to back, by a compute pass.

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

With `heterogeneousVolumesShadowsPipeline` at 1 the grids are built in the shadows phase of every image, whether or not the volumes cast shadows. The volumes are
rasterized into them: each top-level cell a volume's box meets gets the voxel its distance and `heterogeneousVolumesShadowsShadingRate` (1 pixel in the view,
`...ShadowsOutOfFrustumShadingRate` 2 out of it) ask, its bottom level and indirection cells are taken from pools sized by
`heterogeneousVolumesOrthoGridMaxBottomLevelMemoryInMegabytes` (128, `...FrustumGridMaxBottomLevelMemoryInMegabytes` 128 for the frustum grid, which the shadows
do not build), and the volume's material is evaluated at the voxels. A region of a bottom level whose extinction hardly varies (a relative error under
`heterogeneousVolumesBottomLevelGridHomogeneousAggregationThreshold`, 0.001, and under four empty voxels) is stored as one voxel while
`heterogeneousVolumesBottomLevelGridHomogeneousAggregation` is on, the default. A pool that is full leaves the cells that would not fit empty; a bottom level
of three voxels a side takes two, which the Morton order the cells are found by needs. `heterogeneousVolumesShadowsLightDirectional`, `...Point`, `...Spot`
and `...Rect`, all on, say which kinds of light cast a volumetric shadow. The map of each light is rendered through the grids, a list of samples a
texel along the rays of the light's beer map, and kept as that map, or as the adaptive one with `heterogeneousVolumesShadowsType` 0.

`heterogeneousVolumesDebug` (0, off) replaces the image of the volumes by the transmittance through the grids, the opacity left in the alpha and, in the
colour, what the way of finding it gathers: 1 walks the ortho grid and the frustum grid cell by cell; 2 to 5 follow the ray by samples (steps of a voxel, the majorant of the
cell under each step, the greatest majorant of the grid, the cells of the majorant grid in turn); 6 to 9 track it with random walks (spectral weighted delta, ratio, spectral ratio,
the cells of the majorant grid in turn, each by delta tracking), one walk a pixel, so the image is noisy and the temporal pass accumulates it. The views `world.diagnostic.mode`
takes, `'heterogeneous-volumes-dda-marching'`, `'...-sample-marching'`, `'...-sample-majorant'`, `'...-sample-max-majorant'`, `'...-sample-majorant-dda'`,
`'...-delta-tracking'`, `'...-ratio-tracking'`, `'...-spectral-ratio-tracking'` and `'...-tracking-majorant-dda'`, are the modes 1 to 9.

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
