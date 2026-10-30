# Ambient occlusion

The engine finds ambient-light loss from the drawn depth by two methods, one byte a pixel. Lighting
multiplies it into surface emission and the sky light's diffuse (by the smaller of the material's
occlusion and this one); never into a declared light.

It draws **where no global illumination is on**: `bounce: false` (the `smooth` quality level writes
it, plus `ambientOcclusionLevels: 0`). With the bounce on, at any screen-probe level, `'off'`
included, the view draws no occlusion, holds no texture and runs no pass. With
`ambientOcclusionWithScreenProbes` (off) and `screenProbeShortRangeOcclusion` off (the probes' own), it occludes
the probes' light alone, at `screenProbeOcclusionIntensity`.

## The disc search

`ambientOcclusionMethod: 'disc'`, the default. Each pixel searches the depth round it along a few
noise-turned directions and distances. Runs at full, half and quarter size, each coarser result
blended into the finer. `ambientOcclusionCompute` 1 or more: one resolution, depth normals, no quad
blur, smoothed (`ambientOcclusionComputeSmooth`) where the image does not accumulate in time.

## The horizon search

`ambientOcclusionMethod: 'horizon'`. Each pixel finds the highest horizon each side along
`ambientOcclusionHorizonAngles` image directions and integrates the sky left against the normal.
The result is:

- blurred in space (square filter weighing neighbours by nearness to the pixel's plane; applies
  power and intensity; spatial filter off: the last pass applies them);
- blended in time into the last image's (clamped to the neighbourhood, reprojected; history white
  where it does not reach);
- upsampled to the image's size.

The history belongs to the view: intensity, power or radius changes keep it; a cut, a texture
remake (filters, half-size search, resize) or a skipped image restarts it. A view at rest is
redrawn until the history has `ceil(ln 0.1 / ln(1 − blend))` images (22 at blend 0.1), then held.
Own radius `ambientOcclusionHorizonRadius`; fade, quality shape, power and intensity are shared.

## The ray-traced occlusion

`rayTracedAmbientOcclusion`, off by default. Each pixel casts rays over its geometric-normal
hemisphere through the scene's triangles (`rayTracingFile`) as far as
`rayTracedAmbientOcclusionRadius`, keeps the share that arrive, each ray weighted by its
shading-normal cosine over the geometric one. The geometric normal comes from the depth round the
pixel (a thin two-sided sheet and a silhouette keep the shading normal).

- It replaces the screen-space search wherever on and the scene has triangles, whatever
  `ambientOcclusion` says; drawn only where no global illumination is on; applied as the search's
  (`ambientOcclusionStaticFraction`). With no triangles, or while compiling, the search stays.
- On when `rayTracedAmbientOcclusionAllowed` holds (off while project `rayTracing` is off),
  `rayTracedAmbientOcclusion` is `'on'` (or `'auto'` with `rayTracedAmbientOcclusionEnabled` on) and
  `rayTracedAmbientOcclusionIntensity` is above 0.
- Ray start offset: the larger of 1/10000 of the eye distance and `rayTracedShadowsNormalBias`
  (reference `r.RayTracing.NormalBias`).
- The kernel also writes the nearest hit distance (100 m for none, below zero for no ray cast).
  `rayTracedAmbientOcclusionDenoiser` (on; reference `r.AmbientOcclusion.Denoiser`, values 1 and 2
  are one denoiser) runs the screen-space denoiser on the pair:
  1. ingestion into samples whose radius is that distance;
  2. reconstruction (descending rings, `…ReconstructionSamples` at most);
  3. pre-convolutions (`…PreConvolution` webs, first `…KernelSpreadFactor` pixels wide, doubling);
  4. rejection pre-convolution (first two moments over the pixel and four neighbours);
  5. accumulation in time (256 samples; bounded to 6 deviations of the neighbourhood's moments;
     none for an unlit pixel);
  6. when `…HistoryConvolutionSamples` is above 1, a history convolution
     `…HistoryConvolutionKernelSpreadFactor` pixels wide.

  A quiet view is redrawn until the history settles (231 images), then holds.

Differences from the reference (faults fixed):

- Temporal-rejection sample set: reference picks a 7x7 box (49 taps) by a mistyped test; here the
  rotated 3x3.
- Samples' hit distance sits in a field the kernels do not read (radius invalid); here the radius
  is the hit distance.
- Geometric normal reads depth at the clamped pixel but places it unclamped; here both clamped.
- Orthographic: pixel radius undivided by width (silhouette test five half-widths); here divided.
- Horizon at half size: reference's spatial filter reads depth at the wrong place (top-left
  quarter); here at the texel.
- Spatial filter off: reference leaves the integral at 2/π (0.637), never applies power or
  intensity (36 % darker); here the last pass rescales to one and applies both.

## Settings

Defaults are the reference's; lengths in metres.

| Setting | Default | Meaning |
| - | - | - |
| `ambientOcclusion` | `true` | Master switch; `false` draws none. |
| `ambientOcclusionMethod` | `'disc'` | `'disc'` or `'horizon'`. |
| `ambientOcclusionIntensity` | `0.5` | Share shown, 0 to 1; 0 is off. |
| `ambientOcclusionStaticFraction` | `1` | Share of emission darkened, 0 to 1. |
| `ambientOcclusionRadius` | `2` | Reach in metres (disc). View-space mode: the radius at 4 m from the eye, growing with distance. |
| `ambientOcclusionRadiusInWorldSpace` | `false` | World-space radius at any distance. |
| `ambientOcclusionFadeDistance`, `ambientOcclusionFadeRadius` | `80`, `50` | Gone at 80 m, fading over the last 50 (both methods). |
| `ambientOcclusionPower` | `2` | Exponent, from 0.1. |
| `ambientOcclusionBias` | `3` | Lift along the normal, thousandths of depth (disc). |
| `ambientOcclusionQuality` | `50` | 0 to 100: disc resolutions (one below 35, two below 70, three above) and samples a pixel (steps 5, 25, 55, 75); horizon steps. |
| `ambientOcclusionLevels` | `-1` | Resolutions 1 to 3, 0 none (horizon too); -1 follows quality. |
| `ambientOcclusionMaxQuality` | `100` | Quality ceiling; negative forces quality to its absolute value. |
| `ambientOcclusionMipBlend`, `ambientOcclusionMipScale`, `ambientOcclusionMipThreshold` | `0.6`, `1.7`, `0.01` | Coarser result's blend share; radius growth per coarser resolution; depth step under which neighbours are one surface. |
| `ambientOcclusionMipLevelFactor` | `0.4` | Speed samples climb the depth pyramid; at 1 or less they stay on the finest. |
| `ambientOcclusionRadiusScale` | `1` | Radius scale, 0.1 to 15. |
| `ambientOcclusionWithScreenProbes` | `false` | Draw over the probes' light, while their short-range occlusion is off. |
| `ambientOcclusionCompute` | `0` | 0 pixel passes; 1 to 3 single compute-style pass. 2 and 3 name an async queue a browser lacks: same pass. |
| `ambientOcclusionComputeSmooth` | `true` | Compute pass smoothed (box of four taps two texels apart) where the image does not accumulate in time. |
| `ambientOcclusionHorizonNormals` | `false` | Horizon reads the surfaces' normals, not the depth's. |
| `ambientOcclusionHorizonFilterWidth` | `5` | Spatial filter side in pixels: 3 and 4 as given, else 5. |
| `ambientOcclusionHorizonThickness` | `0.5` | Surface thickness (squared); more lowers a thin surface's occlusion. |
| `ambientOcclusionHorizonRadius` | `2` | Metres, from 0, beyond which an occluder stops counting. |
| `ambientOcclusionHorizonAngles` | `2` | Directions a pixel searches, 1 to 16, over half a turn. |
| `ambientOcclusionHorizonPauseJitter` | `false` | Directions stop turning between images. |
| `ambientOcclusionHorizonDownsample` | `false` | Horizon at half size, upsampled at the end. |
| `ambientOcclusionHorizonTemporal`, `ambientOcclusionHorizonSpatial` | `true`, `true` | Temporal filter; spatial filter (compute pass). |
| `ambientOcclusionHorizonBlend` | `0.1` | Share of this image the temporal filter takes, from 0. |
| `rayTracedAmbientOcclusion` | `'auto'` | `'off'`, `'on'`, `'auto'` (follows `rayTracedAmbientOcclusionEnabled`; reference -1 / 0 / 1). |
| `rayTracedAmbientOcclusionAllowed` | `true` | Scalability switch; reads off while project `rayTracing` is off. |
| `rayTracedAmbientOcclusionEnabled` | `false` | Post-process volume's switch, read when `'auto'`. |
| `rayTracedAmbientOcclusionSamplesPerPixel` | `-1` | Rays a pixel, from 0 (unoccluded); -1 uses `rayTracedAmbientOcclusionPostProcessSamplesPerPixel`. |
| `rayTracedAmbientOcclusionPostProcessSamplesPerPixel` | `1` | Volume's rays a pixel, from 1. |
| `rayTracedAmbientOcclusionRadius` | `2` | Farthest ray, 0 to 100. |
| `rayTracedAmbientOcclusionIntensity` | `1` | Darkening of a blocked ray, 0 to 1; 0 draws none. |
| `rayTracedAmbientOcclusionTwoSidedGeometry` | `false` | Occludes from both faces; off passes back faces. |
| `rayTracedAmbientOcclusionMaterials` | `false` | Rays cut masked surfaces by mask; off, every triangle is opaque. |
| `rayTracedAmbientOcclusionDenoiser` | `true` | Denoise occlusion and nearest-blocker distance; off keeps raw rays. |
| `rayTracedAmbientOcclusionDenoiserReconstructionSamples` | `16` | Most reconstruction samples, 1 to 56. |
| `rayTracedAmbientOcclusionDenoiserPreConvolution` | `2` | Pre-convolution passes, 0 to 4. |
| `rayTracedAmbientOcclusionDenoiserKernelSpreadFactor` | `4` | First pre-convolution spread in pixels, doubling per pass; 0 to 64. |
| `rayTracedAmbientOcclusionDenoiserTemporalAccumulation` | `true` | Accumulate over images. |
| `rayTracedAmbientOcclusionDenoiserHistoryConvolutionSamples` | `1` | History convolution samples, 1 to 56; 1 runs none. |
| `rayTracedAmbientOcclusionDenoiserHistoryConvolutionKernelSpreadFactor` | `7` | That convolution's spread in pixels; 0 to 64. |

## Quality levels

The quality levels (`world.quality`, group `imageEffects`) write resolutions, ceiling, climb and
radius scale:

- `smooth`: `ambientOcclusionLevels` 0 (none drawn), ceiling 0, climb 1, scale 1.2;
- `balanced`: follows quality, ceiling 60, climb 1, scale 1.5;
- `fine`: ceiling 100, climb 0.6, scale 1.5;
- `max` writes nothing: defaults are the reference's (ceiling 100, climb 0.4, scale 1);
- `cinematic`: as `max`, plus `ambientOcclusionHorizonAngles` 4.

A value the page writes holds over the level. Not offered: the reference's falloff ratio, upsample
switch, deprecated distance, depth-bounds test, framebuffer compression.

Frame metrics publish `ambientOcclusion: { method, drawn, bytes, why }`: method run, whether
drawn, texture bytes, and the reason when the memory budget kept the view from being made. Agents
use `trillion3d_set_ambient_occlusion`.

```js
const world = createWorld({
  canvas,
  ambientOcclusionIntensity: 0.7, // a stronger darkening than the default 0.5
  bounce: false, // the occlusion draws where no global illumination is on
})
world.ambientOcclusion = { ambientOcclusionRadius: 3 } // a wider reach, from the next frame
world.ambientOcclusion = { ambientOcclusionMethod: 'horizon', ambientOcclusionHorizonAngles: 4 } // the horizon search, four directions
world.ambientOcclusion = { ambientOcclusionMethod: 'disc', ambientOcclusionCompute: 1 } // the disc search in one resolution, smoothed
world.ambientOcclusion = { ambientOcclusionRadius: null } // null gives a setting back to the preset
world.quality.preset = 'balanced' // writes the resolutions' ceiling, the climb and the radius scale
world.ambientOcclusion = { ambientOcclusion: false } // off: no pass, no texture, no byte
world.ambientOcclusion = { rayTracedAmbientOcclusion: 'on' } // rays through the scene's triangles in place of the search
world.ambientOcclusion = { rayTracedAmbientOcclusionSamplesPerPixel: 4, rayTracedAmbientOcclusionRadius: 5 } // four rays a pixel, up to 5 m
world.ambientOcclusion = { rayTracedAmbientOcclusion: 'auto', rayTracedAmbientOcclusionEnabled: true } // the post-process volume's way
world.ambientOcclusion = { rayTracedAmbientOcclusion: 'on', rayTracedAmbientOcclusionDenoiser: false } // the raw rays, no denoiser
world.ambientOcclusion = { rayTracedAmbientOcclusion: 'on', rayTracedAmbientOcclusionSamplesPerPixel: 2, rayTracedAmbientOcclusionDenoiserPreConvolution: 3 } // two rays a pixel, three pre-convolutions
```

The explorer takes the same by field (`explorer.setAmbientOcclusion('ambientOcclusionPower', 3)`).
