# WebGPU page raster

`webgpuPagesEngine` (`frame/backend/pages.ts`) draws from the bounded page cache of `pages/pool/pages.ts`: a compute pass selects the camera's resident cut and draws it through indirect commands into a visibility buffer. Parts:

- [The cut](webgpu-page-raster/the-cut.md): selection, occlusion, caps, the visible clusters
- [Cut settings and draw distances](webgpu-page-raster/cut-settings-and-draw-distances.md): draw distances, the cut's time budget, the settings table
- [Depth pyramid and light grid](webgpu-page-raster/depth-pyramid-and-light-grid.md): trace layers, light grid, the primed pyramid, `hiz` settings
- [Rasterizers and voxels](webgpu-page-raster/rasterizers-and-voxels.md): hardware and software raster, bins, the visibility write, voxel pages
