# Ray-traced sky light

The sky light's diffuse light can be found by rays cast from
each pixel through the scene's triangles toward the sky, drawn by the sky's importance table, instead of
the capture's harmonics. The sky light asks with its fields `castRayTracedShadow` (`'useProjectSetting'`,
`'enabled'`, `'disabled'`), `samplesPerPixel` (4; never fewer than 2 rays are cast) and `transmission`
(`false`). The view's settings, all with the reference's default:

| Setting | Default | Meaning |
| --- | --- | --- |
| `rayTracedSkyLight` | `false` | the sky lights that follow the view are lit by rays |
| `rayTracedSkyLightAllowed` | `true` | the project's switch; reads off while `rayTracingEnable` is off |
| `rayTracedSkyLightSamplesPerPixel` | `-1` | rays a pixel; `-1` leaves it to the sky light |
| `rayTracedSkyLightMaxRayDistance` | `10000000` | centimetres, the longest a ray goes |
| `rayTracedSkyLightMaxShadowThickness` | `1000` | centimetres, the start of the ray that measures a hair pixel's thickness |
| `rayTracedSkyLightDenoiser` | `true` | the rays' light is denoised and accumulated over the images |
| `rayTracedSkyLightDenoiserReconstructionSamples` / `PreConvolution` / `TemporalAccumulation` | `16` / `1` / `true` | the denoiser's passes |
| `rayTracedSkyLightDenoiserHistoryConvolutionSamples` / `HistoryConvolutionKernelSpreadFactor` | `1` / `3` | samples (1 to 56; 1 runs none) and spread, in pixels, of the convolution of the accumulated history |
| `rayTracedSkyLightTwoSidedGeometry` | `true` | geometry occludes from both faces |
| `rayTracedSkyLightMaterials` | `true` | masked surfaces are cut by their mask |
| `rayTracedSkyLightDecoupleSampleGeneration` | `true` | the directions are drawn once in a 256 by 256 table by a pass of their own |
| `rayTracedSkyLightHairVoxel` | `true` | the hair voxels take part in the occlusion of the surfaces about the strands |
| `rayTracedSkyLightHairOcclusionThreshold` | `1` | hair count the strands' voxels must hold along a ray before it counts as blocked (from 0) |
| `rayTracedSkyLightScreenPercentage` | `100` | share of the resolution the rays are cast at (25 to 100, whole division) |

```js
// Every sky light that follows the view is lit by rays, four a pixel, at half resolution; then one sky light alone, whatever the view says.
const world = await createWorld({
  rayTracedSkyLight: true,
  rayTracedSkyLightSamplesPerPixel: 4,
  rayTracedSkyLightScreenPercentage: 50,
})
sky.skyLight = { castRayTracedShadow: 'enabled', samplesPerPixel: 8 }
```

The denoiser is the diffuse signal of the shadows' denoiser (`lighting/shadows/denoise`), the one frame
that filters the rays' shadows and occlusion. The trace gives it the light with the share of rays that
hit, the hits' distance and the rays a pixel. Its reconstruction fills the full-resolution image from
the rays' grid (a ray cast from a different pixel of each cell every image, whatever the division); the
pre-convolutions and the accumulation in time keep the history inside the neighbourhood's colours; the
optional convolution of the history cleans it further. The sample is two textures: the mean colour (half
floats) and the sample's weight in a whole float (the reference holds it in half floats; a weight past
ten bits of mantissa loses nothing here).

The ray-traced sky light follows the reference in every step and fixes what the reference gets wrong;
each fix is declared here:

- the cell's pixel the rays are cast from each image is the frame modulo the number of the cell's pixels
  (the reference masks the frame with the square of the division less one, which never visits some
  pixels of a cell for a division of 3); the denoiser finds the ray nearest a pixel from that same
  pixel, by a signed division (the reference divides an unsigned value and, for the first pixels of an
  edge, reads the grid's far edge);
- the sky light's harmonics are cut from the pixels only where the rays light them this image (the
  reference cuts them wherever a ray-traced sky light is on, so the sky vanishes where its composite
  does not run);
- the sky light's read block holds one field more, `replaced`, which the harmonics' diffuse reads to give
  nothing while the rays supply it: every program that reads the sky light changes its text, and the
  image of a scene lit by the harmonics does not change.

The light is the pixel's shading model's, as the reference's per-ray evaluation gives it:

- the Lambert diffuse times the cosine for the plain and the subsurface models, and the Burley diffuse
  (retro-reflection of the view and of the ray) times the cosine for a subsurface profile; both are
  weighed by what the specular lobe leaves of the light, one minus the luminance of the lobe's energy
  (the GGX energy table of the light buffer, read at the view's cosine and the roughness; a profile's two
  lobes at their mean roughness). A preintegrated skin keeps its plain term;
- a toon pixel's closure with every shadow term nil: its diffuse ramp read at the signed cosine
  remapped to 0 to 1 (a ray below the horizon counts), a shadow of nothing unless the ramp includes the
  shadow, times the diffuse colour over pi;
- a hair's own fibre scattering with no cosine (and, once the rays are done, its multiple scattering: the
  sky's harmonics along the mean direction of the rays that escaped, weighed by the fibre's Kajiya-Kay
  attenuation, by the thickness of the shadow measured by one more ray of
  `rayTracedSkyLightMaxShadowThickness` and by the share of the rays that did not hit);
- an eye's term in place of its diffuse.

With the sky light's `transmission` field on, the model's transmission toward each ray (the thin
subsurface's, the skin's, the eye's, the hair's) is added, unshadowed; a subsurface profile's transmission
is the lights', and the sky has none. The trace divides the light by the pixel's diffuse colour and the
composite multiplies it back after the denoiser, so the denoiser filters a colour-free signal.

**The strands' voxels.** With `rayTracedSkyLightHairVoxel` on and strands in the view that are
voxelized, a ray of a pixel that is not hair is also marched through the voxels of every group of
strands, up to the scene's hit or ten metres: the march stops where one hair is crossed, and that
counts as a hit at that distance (the hair count that blocks is `rayTracedSkyLightHairOcclusionThreshold`, 1 by default; at 0 the march never stops early, so the strands never block a ray, as the reference), so the strands shade the surfaces about them. The march uses the
voxel volume's scales for the density and the step of the rays, `hairVoxelDensityScaleRaytracing` and
`hairVoxelSteppingScaleRaytracing` (both `-1` by default: below 0 the global `hairVoxelDensityScale` and
`hairVoxelSteppingScale` stand; the step is held to 1 to 10)
and its jitter (`hairVoxelJitter`: the start moves with the frame, stays still, or none). The trace
binds the voxels in a group of their own and so needs a device that grants nine storage buffers a
stage; on a device that grants fewer, the strands' voxels are left out of the occlusion.

```js
// The strands' voxels shade the surfaces about them (the default); then the rays meet the scene's triangles alone.
const world = await createWorld({ rayTracedSkyLight: true })
const bare = await createWorld({ rayTracedSkyLight: true, rayTracedSkyLightHairVoxel: false })
// The sky rays march the voxels at their own density and step, and need two hairs crossed to be blocked.
const tuned = await createWorld({
  rayTracedSkyLight: true,
  hairVoxelDensityScaleRaytracing: 3,
  hairVoxelSteppingScaleRaytracing: 2,
  rayTracedSkyLightHairOcclusionThreshold: 2,
})
```
