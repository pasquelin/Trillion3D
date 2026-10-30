# Subsurface scattering

**Subsurface scattering** (`lighting/subsurface/`). After the lights and before the sky, a view whose surfaces may carry a
subsurface-profile pixel (`SurfaceBuffer.hasSubsurface`) runs `encodeSubsurfaceScattering`. The lit image holds, per pixel of the
model, the colour (diffuse and specular light) and in its alpha the luminance of the diffuse light (or, with the checkerboard,
the diffuse light on one pixel of two); the surface holds the profile (`x`) and opacity (`w`) in its per-model data. The pass is
tiled in 8 × 8 texels of the scattering's resolution (the image's, or its half): `sssMark` sets a bit a tile in three masks (any
profile pixel; all of them scatter inside their own footprint, "pass-through"; the others), `sssLists` builds each mask's list in
z-order, `sssArgsTiles` the arguments of the indirect dispatches and draws. The setup writes the diffuse light, the depth in
centimetres and the profile of each pixel (`sssSetupMain` over the scattering tiles, `sssSetupPass` over the pass-through ones, into
the last target), lists the scattering tiles by how their pixels scatter (sampled or separable) and `sssArgsScatter` sizes the mip
chain (six levels, a bilinear 2 × 2 filter with a zero border) made when the sampled tiles reach `subsurfaceBurleyMipsMinTileCount`.
The sampled scattering (`sssSampledScatter`: a group reads its ten by ten texels into memory, each pixel draws a count of samples
from its history's variance, radii from the profile's distribution, angles from the R2 sequence, a mip from the sample's density,
and weighs by the diffusion profile over the density, the normals and the depth) and the separable one (`sssSeparableHorizontal`,
`sssSeparableVertical`: the profile's kernel, a boundary tint where the profile changes) leave the scattered light in two targets;
`sssVariance` updates the quality history (a pair of textures, reprojected by the camera and the velocity stage) of the sampled
pixels. The recombine draws a quad a tile of the `all` list into an image of its own, rebuilding the diffuse and the specular
light (`sssReconstruct`), mixing the diffuse with the scattered by the profile's tint and multiplying by the base colour, and the
copy writes it over the lit image (nothing is read where it is written). A list longer than 65535 tiles wraps its dispatch onto a
second axis. The profile ids are stored as `r8uint` where the device grants `texture-formats-tier1`, else `r32uint`. With the scale
at 0 only the reconstruction is drawn, over the whole image.
