# Ambient occlusion

A crease, a corner or the foot of a wall receives less of the light that comes from all round than an
open surface does. The engine finds that loss in the depth the image drew, by one of two methods, and
leaves one byte a pixel, which the lighting multiplies in where it belongs: the emission of a surface
(the light the base pass left in the picture) and the sky light's diffuse (by the smaller of the
material's occlusion and this one), never a declared light, whose shadows are its own.

It draws **where no global illumination is on**, that is, with the bounce off (`bounce: false`, which
a page writes: the `smooth` quality level writes it too, but also `ambientOcclusionLevels: 0`, so that
nothing is searched there). With the bounce on, at any level of the screen probes, `'off'` included,
where the world's probes light the pixels, the probes carry their own short-range occlusion
(`screenProbeShortRangeOcclusion`), the same contact shadow found another way, and the two never
meet: a view draws no ambient occlusion, holds no texture for it and runs no pass.
`ambientOcclusionWithScreenProbes` (off) draws it over the probes' light too, but only while their own
short-range occlusion is off (`screenProbeShortRangeOcclusion: false`), and then it occludes their
light alone, at the strength `screenProbeOcclusionIntensity` names.

## The disc search

`ambientOcclusionMethod: 'disc'`, the default. Each pixel searches the depth round it, along a few
directions turned by a small noise and at a few distances, for what rises above its surface, and keeps
the share of the sky it still sees. The search runs at the image's size and at its half and its
quarter, each coarser result blended into the finer one. With `ambientOcclusionCompute` from 1 up the
search is made in one resolution from the normals the depth gives, without the blur among the four
pixels of a quad, and, where the image does not accumulate in time, smoothed
(`ambientOcclusionComputeSmooth`).

## The horizon search

`ambientOcclusionMethod: 'horizon'`. Each pixel looks, along a few directions in the image
(`ambientOcclusionHorizonAngles`), for the highest horizon each side of it finds in the depth, and
integrates the sky that is left against the surface's normal. The result is:

- blurred in space (a square filter that weighs each neighbour by how near it lies to the pixel's
  plane, which also applies the power and the intensity);
- blended in time into the last image's (clamped to the neighbourhood of this one, the last image
  found again through the motion of the camera, or of the surface where it moves by itself; the
  history is white where it does not reach);
- upsampled to the image's size.

The history belongs to the view: dragging the intensity, the power or the radius keeps it, only a cut
or a change that remakes the textures (the filters, the half-size search, a resize) starts it again,
and so does an image it skipped. A view at rest is drawn again until the history has the images it
needs to come within a tenth of what it converges to (22 at the default blend of 0.1:
`ceil(ln 0.1 / ln(1 − blend))`), whatever the temporal anti-aliasing does, then held. It has its own
radius, `ambientOcclusionHorizonRadius`; the distance fade, the quality's shape, the power and the
intensity are the occlusion's. With the spatial filter off, the last pass of the method applies the
power and the intensity itself, so that the setting changes the softness and nothing else.

## The ray-traced occlusion

`rayTracedAmbientOcclusion` is a third way to find the occlusion, off by default (the reference's
post-process switch is off). Each pixel casts rays over the hemisphere of its surface's geometric
normal through the scene's triangles (the scene trace the lighting makes for the image,
`rayTracingFile`), as far as `rayTracedAmbientOcclusionRadius`, and keeps the share that arrive, every
ray weighted by the cosine its shading normal gives it over the cosine of the geometric one. The
geometric normal is found from the depth round the pixel (a thin two-sided sheet and a silhouette keep
the shading normal), and the overlap of the two normals' lobes is a factor of the result.

- It replaces the screen-space search wherever it is on and the scene has triangles, whatever
  `ambientOcclusion` says, and, like it, is drawn only where no global illumination is on; the
  lighting applies the texture as it applies the search's (`ambientOcclusionStaticFraction`). Where
  the scene has no triangles, or while its program compiles, the image keeps the search.
- It is wanted where `rayTracedAmbientOcclusionAllowed` holds (it reads off while the project's
  `rayTracing` switch is off), `rayTracedAmbientOcclusion` says `'on'` (or `'auto'` and
  `rayTracedAmbientOcclusionEnabled` is on) and `rayTracedAmbientOcclusionIntensity` is above 0.
- The ray's start leaves the surface by the larger of a ten-thousandth of the distance to the eye and
  the ray-traced shadows' normal bias (`rayTracedShadowsNormalBias`, the reference's one
  `r.RayTracing.NormalBias`), the start the ray-traced shadows' rays have.
- Beside the occlusion the kernel writes the distance of the nearest primitive any of the pixel's
  rays hit (100 m where none did, below zero where it cast none), and
  `rayTracedAmbientOcclusionDenoiser` (on, the reference's `r.AmbientOcclusion.Denoiser`, whose
  values 1 and 2 are one denoiser here) runs the screen-space denoiser on the two:
  1. the injestion of the pair into samples whose radius is that distance;
  2. the reconstruction (the quad's stochastic sets, in descending rings,
     `rayTracedAmbientOcclusionDenoiserReconstructionSamples` of them at most);
  3. the pre-convolutions (`…PreConvolution` webs, the first `…KernelSpreadFactor` pixels wide,
     doubling with each);
  4. a rejection pre-convolution (the share's first two moments over the pixel and its four
     neighbours);
  5. the accumulation in time (the history held to 256 samples; bounded to 6 deviations of the
     neighbourhood's moments; none for an unlit pixel);
  6. when `…HistoryConvolutionSamples` is above 1, a convolution of the history
     `…HistoryConvolutionKernelSpreadFactor` pixels wide.

  These are the shadow denoiser's kernels run on this signal. A quiet view is drawn again until the
  history has settled (231 images), then holds.

Three faults of the reference's denoiser and kernel are fixed:

- Its sample set for the temporal rejection is meant to be the rotated three by three, but a
  mistyped test of the shader selects a seven by seven box (forty-nine taps); here, the rotated three
  by three.
- Its occlusion samples carry the hit distance in a field the kernels do not read (they read
  another, left invalid), so that every sample's radius is invalid and the descending rings never
  tell a near blocker from a far one; here the radius of a sample is its hit distance, which the
  rings use as they do for the shadows.
- Its geometric normal reads a neighbour's depth at the pixel clamped to the view but places it at
  the unclamped pixel, so that a pixel on the view's edge finds a normal from points that are not
  neighbours; here both are read at the clamped pixel.

Another fault, in its orthographic projection, is fixed too: the pixel's radius is not divided by the
width, so that the silhouette test is five half-widths of the view; here it is.

## Settings

Every setting has the reference's default. Lengths are in metres (the reference's centimetres over a
hundred):

| Setting | Default | Meaning |
| --- | --- | --- |
| `ambientOcclusion` | `true` | The master switch; `false` draws none. |
| `ambientOcclusionMethod` | `'disc'` | `'disc'` or `'horizon'`. |
| `ambientOcclusionIntensity` | `0.5` | How much of the occlusion shows, 0 to 1; 0 is off. |
| `ambientOcclusionStaticFraction` | `1` | The share of a surface's emission the occlusion darkens, 0 to 1. |
| `ambientOcclusionRadius` | `2` | How far from a point a surface may lie and occlude it, in metres (the disc search). In the default view-space mode it is the radius at 4 m from the eye and grows with the distance. |
| `ambientOcclusionRadiusInWorldSpace` | `false` | The radius is the world's, at any distance. |
| `ambientOcclusionFadeDistance`, `ambientOcclusionFadeRadius` | `80`, `50` | The occlusion has faded to nothing at 80 m, fading over the last 50 (both methods). |
| `ambientOcclusionPower` | `2` | The exponent of the occlusion, from 0.1. |
| `ambientOcclusionBias` | `3` | How far a point is lifted off its surface along its normal, in thousandths of its depth (the disc search). |
| `ambientOcclusionQuality` | `50` | 0 to 100: the resolutions of the disc search (one below 35, two below 70, three above) and the samples a pixel takes (five shapes: 5, 25, 55 and 75 are the steps), the steps of the horizon search. |
| `ambientOcclusionLevels` | `-1` | The resolutions, 1 to 3, 0 none (the horizon search too); -1 follows the quality. |
| `ambientOcclusionMaxQuality` | `100` | A ceiling on the quality; a negative value forces the quality its absolute value names. |
| `ambientOcclusionMipBlend`, `ambientOcclusionMipScale`, `ambientOcclusionMipThreshold` | `0.6`, `1.7`, `0.01` | The share of the coarser result blended in, the radius's growth at each coarser resolution, and the depth step under which neighbours count as one surface when a resolution is made. |
| `ambientOcclusionMipLevelFactor` | `0.4` | How fast the samples climb the depth pyramid's coarser levels along the search; at 1 or less they stay on the finest. |
| `ambientOcclusionRadiusScale` | `1` | A scale on the radius, 0.1 to 15. |
| `ambientOcclusionWithScreenProbes` | `false` | Draw it over the probes' light, while the screen probes' own short-range occlusion is off. |
| `ambientOcclusionCompute` | `0` | 0 the pixel passes; 1 to 3 the single compute-style pass (one resolution, the depth's normals, no quad blur). 2 and 3 name an asynchronous queue a browser device lacks: all three make the same pass. |
| `ambientOcclusionComputeSmooth` | `true` | The compute pass is smoothed (a box of four taps two texels apart) where the image does not accumulate in time. |
| `ambientOcclusionHorizonNormals` | `false` | The horizon search reads the surfaces' own normals rather than the depth's. |
| `ambientOcclusionHorizonFilterWidth` | `5` | The side of the spatial filter in pixels: 3 and 4 as they are, any other number the five-wide filter. |
| `ambientOcclusionHorizonThickness` | `0.5` | How thick a surface is taken to be (any number, it is squared): more lowers the occlusion a thin surface casts. |
| `ambientOcclusionHorizonRadius` | `2` | The distance in metres, from 0, at which an occluder stops counting for the horizon search. |
| `ambientOcclusionHorizonAngles` | `2` | The directions a pixel searches, 1 to 16, spread over half a turn. |
| `ambientOcclusionHorizonPauseJitter` | `false` | The directions stop turning from image to image. |
| `ambientOcclusionHorizonDownsample` | `false` | The horizon search runs at half the image's size and is upsampled at the end (the spatial filter then reads the depth at the right place; see below). |
| `ambientOcclusionHorizonTemporal`, `ambientOcclusionHorizonSpatial` | `true`, `true` | The temporal filter and the spatial filter (a compute pass). With the spatial filter off the power and the intensity apply in the method's last pass. |
| `ambientOcclusionHorizonBlend` | `0.1` | The share of this image the temporal filter takes, from 0; the rest is the history's. |
| `rayTracedAmbientOcclusion` | `'auto'` | `'off'`, `'on'`, or `'auto'`, which follows `rayTracedAmbientOcclusionEnabled` (the reference's -1 / 0 / 1). |
| `rayTracedAmbientOcclusionAllowed` | `true` | The scalability switch that lets it be on; it reads off while the project's `rayTracing` switch is off. |
| `rayTracedAmbientOcclusionEnabled` | `false` | The post-process volume's switch, read where `rayTracedAmbientOcclusion` is `'auto'`. |
| `rayTracedAmbientOcclusionSamplesPerPixel` | `-1` | The rays a pixel casts, from 0 (none: the pixel is unoccluded); -1 leaves it to `rayTracedAmbientOcclusionPostProcessSamplesPerPixel`. |
| `rayTracedAmbientOcclusionPostProcessSamplesPerPixel` | `1` | The post-process volume's rays a pixel casts, from 1. |
| `rayTracedAmbientOcclusionRadius` | `2` | The farthest a ray goes, in metres, 0 to 100. |
| `rayTracedAmbientOcclusionIntensity` | `1` | How much a blocked ray darkens, 0 to 1; 0 draws none. |
| `rayTracedAmbientOcclusionTwoSidedGeometry` | `false` | The geometry occludes from both faces; off, back faces are passed. |
| `rayTracedAmbientOcclusionMaterials` | `false` | The rays cut the masked surfaces by their mask; off, every triangle is opaque to them. |
| `rayTracedAmbientOcclusionDenoiser` | `true` | The result is denoised from the occlusion and the distance of the nearest blocker (reconstruction, pre-convolutions, rejection pre-convolution, accumulation in time); off keeps the raw rays. |
| `rayTracedAmbientOcclusionDenoiserReconstructionSamples` | `16` | The most samples of the denoiser's reconstruction, 1 to 56. |
| `rayTracedAmbientOcclusionDenoiserPreConvolution` | `2` | The pre-convolution passes after it, 0 to 4. |
| `rayTracedAmbientOcclusionDenoiserKernelSpreadFactor` | `4` | The spread of the first pre-convolution, in pixels, doubling with each pass; 0 to 64. |
| `rayTracedAmbientOcclusionDenoiserTemporalAccumulation` | `true` | The denoised occlusion is accumulated over the images. |
| `rayTracedAmbientOcclusionDenoiserHistoryConvolutionSamples` | `1` | The samples of the convolution of the accumulated history, 1 to 56; 1 runs none. |
| `rayTracedAmbientOcclusionDenoiserHistoryConvolutionKernelSpreadFactor` | `7` | The spread of that convolution, in pixels; 0 to 64. |

## Quality levels

The quality levels (`world.quality`, group `imageEffects`) write the reference's five post-process
levels of the resolutions, the ceiling, the climb and the radius scale:

- `smooth`: `ambientOcclusionLevels` 0 (none: no occlusion is drawn at this level), ceiling 0, climb
  1, scale 1.2;
- `balanced`: follows the quality, ceiling 60, climb 1, scale 1.5;
- `fine`: ceiling 100, climb 0.6, scale 1.5;
- `max` writes nothing: the defaults are the reference's own default level (ceiling 100, climb 0.4,
  scale 1);
- `cinematic`: the same as `max`, and the horizon search's number of angles
  (`ambientOcclusionHorizonAngles`) at 4, the one value the reference's fifth level writes of it.

A value the page writes holds over the level. Two settings of the reference are not offered because
they do nothing there (a falloff ratio and an upsample switch that no shader reads); its dead
deprecated distance, its depth-bounds test and its framebuffer compression have no form in a browser.

Two more faults of the reference, fixed:

- With the horizon search at half size the reference's spatial filter reads the depth at the wrong
  place (it is told a reduction of one), so its weights come from the top-left quarter of the
  picture; here the depth is read where the texel is.
- With its spatial filter off the reference leaves the integral as the search writes it, two over π,
  0.637, on every open surface, and never applies the power or the intensity: the whole picture 36 %
  darker and two settings inert; here the method's last pass takes the integral back to one and
  applies both, as the filter does.

The occlusion publishes `ambientOcclusion: { method, drawn, bytes, why }` among the frame's metrics:
which method ran, whether the image drew it, the bytes its textures hold and, where the device's
memory budget kept the view from being made, the reason (the view is then asked again only once the
budget's room holds it). An agent sets the settings through `trillion3d_set_ambient_occlusion`.

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
