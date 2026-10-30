# Sampled lighting: debug views
The sampled lighting (`sampledLights`) and the subsurface scattering have views that draw over the image, as the other diagnostic views do. They are chosen by `world.diagnostic.mode` or by a setting, and need the effect they show to be on.

| Mode | What it shows |
| --- | --- |
| `virtual-shadow-map-shadow-casters` | over the image, the edges of the box of every placement the shadows keep as invalidating or that may, in the colour of its class (red a static one that deforms, purple a dynamic one that moves or deforms, blue a dynamic one whose offset may invalidate), with the legend of the classes at the lower left; the green, cyan and grey classes draw no box |
| `virtual-shadow-map-clipmap-virtual-space` | over the image in grey, a square that shows the pages the first sun's shadow clipmap has mapped, level by level from the finest to the coarsest, each in the colour of its address and level, zoomed so that the finest level's pages fill it; needs shadows (`await engine.setDiagnostic('virtual-shadow-map-clipmap-virtual-space')`) |
| `virtual-shadow-map-shadow-factor` | over the image in grey, the share of each light that reaches the surface: yellow lit, dark blue in shadow, the lights added (the one light `shadowVisualizeLightName` names, alone); the legend at the lower left; needs shadows and virtual shadow maps (`await engine.setDiagnostic('virtual-shadow-map-shadow-factor')`) |
| `virtual-shadow-map-clipmap-or-mip` | over the image in grey, one colour a level: the clipmap level a sun reads at the pixel, or the mip level a local light reads, mixed with the share of light; needs shadows and virtual shadow maps (`await engine.setDiagnostic('virtual-shadow-map-clipmap-or-mip')`) |
| `virtual-shadow-map-virtual-page` | over the image in grey, the virtual page the last ray of the pixel read, in the colour of its address mixed with the colour of its level and the share of light; needs shadows and virtual shadow maps (`await engine.setDiagnostic('virtual-shadow-map-virtual-page')`) |
| `virtual-shadow-map-cached-page` | over the image in grey, the state of the page the pixel reads: green kept from the last image (shown for one light, or for all with `shadowVisualizeCachedPagesOnly`), red both layers drawn again, blue the dynamic layer alone, yellow-green kept by force; with the legend; needs shadows and virtual shadow maps (`await engine.setDiagnostic('virtual-shadow-map-cached-page')`) |
| `virtual-shadow-map-ray-count` | over the image, the rays traced at the pixel against the most the lights trace, from green to red; needs shadows and virtual shadow maps (`await engine.setDiagnostic('virtual-shadow-map-ray-count')`) |
| `virtual-shadow-map-general-debug` | over the image, the mean distance from the pixel to what shadows it as a grey (2000 centimetres to white); needs shadows and virtual shadow maps (`await engine.setDiagnostic('virtual-shadow-map-general-debug')`) |
| `virtual-shadow-map-dirty-page` | over the image in grey, the page the pixel reads, red where its static layer was written (drawn or cleared) this image, green where its dynamic layer was; needs shadows and virtual shadow maps (`await engine.setDiagnostic('virtual-shadow-map-dirty-page')`) |
| `virtual-shadow-map-gpu-invalidated-page` | over the image in grey, the page the pixel reads, red where its static layer was invalidated by the casters that moved, green where its dynamic layer was; needs shadows and virtual shadow maps (`await engine.setDiagnostic('virtual-shadow-map-gpu-invalidated-page')`) |
| `virtual-shadow-map-merged-page` | over the image in grey, the page the pixel reads, red where its static layer was drawn this image and merged into the dynamic one, green elsewhere; needs shadows and virtual shadow maps (`await engine.setDiagnostic('virtual-shadow-map-merged-page')`) |
| `virtual-shadow-map-overdraw` | over the image in grey, how many times the shadow raster drew the texel the pixel reads this image, inferno from dark to bright, scaled by `shadowVisualizeOverdrawScale`; needs shadows and virtual shadow maps |
| `indirect-diffuse` | the indirect light alone, in place of the lit image: black everywhere but on the lit surfaces, each lit by the probes' bounce, the environment, the sky light and the ambient cubemap as if its diffuse colour were a grey of 0.18, a metal's included (its own colours stay for its reflections); no direct light, no emission (`await engine.setDiagnostic('indirect-diffuse')`) |
| `rect-light-atlas` | over the image, the atlas of the rectangle lights' pictures drawn small at the mip level `rectLightAtlasDebugMipLevel`, a green border round each slot in use, red round the packing's horizon lines, yellow round the free rectangles, and the figures as text (the same as `rectLightAtlasDebug`) |
| `sampled-lights-overview` | the shadow caster views side by side, in tiles with rounded corners, over the image |
| `sampled-lights-shadow-casters` | one ray a pixel from the eye through the scene's triangles (`sampledLightsHardwareRayTracing`), each instance it meets in a colour of its own lit by a fixed light, with the label `Shadow Casters, Materials:0, FarField:0, HairVoxels:0` (`Materials` is 1 with `sampledLightsEvaluateMaterialMode` above 0, `HairVoxels` is 1 while the strands' voxels are traced (`sampledLightsHairVoxelTraces`), the rays then marching them too, `FarField` is 0: the scene has no far field); without the rays, the surface under each pixel in grey |
| `sampled-lights-shadow-caster-quality` | the drawn surface in grey with the label that names red a missing caster and blue a mismatching one: orange to red where the ray meets something farther than the drawn surface by more than `sampledLightsVisualizeShadowCasterMissingDistance`, blue where it meets something nearer by more than `sampledLightsVisualizeShadowCasterPoorDistance` (both relaxed at a grazing angle) |
| `sampled-lights-complexity-opaque` | the light complexity of the surfaces: for the pixel under the debug cursor, the lights of its cell of the light grid sorted by the weight the sampling gives them, each as a row of text (its share of the sum, whether it was seen in the image before, its kind and its name) and a line and a symbol from the pixel to it (a sphere for a point light, an arc for a spot, two rectangles for a rectangle light, a line along its direction for a sun; the light under the mouse in orange), and the image in grey times a colour that goes from blue to red with the cost of sampling each pixel |
| `sampled-lights-complexity-front-layer` | the same for the nearest translucent layer (needs `sampledLightsFrontLayer`) |
| `sampled-lights-complexity-hair-strands`, `sampled-lights-complexity-volume`, `sampled-lights-complexity-translucency-volume` | the hair strands' and the volumes' light complexity: not drawn yet (the modes are refused, and the setting below writes that the input is not drawn) |
| `subsurface-profiles` | in the lower right quarter, the whole image's subsurface profile of each pixel: the default skin buff, then red, green, blue, magenta, cyan and yellow, 100 dark green, 255 white, any other mid grey; the profile's number or letter in each cell of eight pixels, all faded where the scattering stays inside a pixel; the title and the list of the profiles are written at the top left |

| Setting | Default | Meaning |
| --- | --- | --- |
| `sampledLightsVisualize` | `0` | A numbered view in place of a mode: 1 the overview, 2 the shadow casters, 3 their quality, 4 and 5 the denoiser overviews (4 by 4 tiles of the views below), 6 the shading confidence, 7 the frames accumulated (red invalid, yellow the first), 8 the upsample mask (yellow: no history), 9 and 10 the diffuse and specular demodulation, 11 and 12 the deviation of each light over its mean (red a disocclusion, blue the spatial filter, violet both), 13 and 14 the history's own deviation (blue above the threshold `sampledLightsSpatialHistoryDeviation`), 15 and 16 the clamp of the history (yellow fully rejected). Each view is labelled at its foot. The setting wins over the mode. |
| `sampledLightsVisualizeShadowCasterMissingDistance` | `0.5` | Metres a traced surface may lie behind the drawn one before it is called missing |
| `sampledLightsVisualizeShadowCasterPoorDistance` | `0.25` | Metres it may lie in front before it is called mismatching |
| `sampledLightsHardwareRayTracing` | `true` | The two shadow caster views (and the overview) cast one ray a pixel from the eye through the scene's triangles and paint what it meets: view 2 each instance in a colour of its own under a fixed light (the label gives `Materials`, `FarField` and `HairVoxels` as 0 or 1), view 3 the drawn surface in grey, orange to red where the ray meets something farther than the drawn surface (a missing caster) and blue where it meets something nearer (a mismatching one). `false`, or `rayTracingEnable` off, or a scene with no triangles to trace: the views paint the surface alone. The sky stays as the image shows it |
| `sampledLightsEvaluateMaterialMode` | `0` | 0 the rays meet every triangle whole; 1 and 2 honour the surfaces' cut-out masks (the reference's any-hit and closest-hit evaluation, which meet the same surface here) |
| `sampledLightsForceTwoSided` | `true` | The rays meet the back of one-sided triangles as well as their front; `false` culls the backs |
| `sampledLightsVisualizeTileClassification` | `0` | The tiles of the classification over the image: 1 the surfaces' tiles, 2 the downsampled tiles (3 to 6 the hair strands' and the nearest layer's, drawn with their own images); each type in its colour with a count table |
| `sampledLightsVisualizeLightComplexity` | `0` | The input of the light complexity view in place of a mode (a mode wins): 1 the surfaces, 2 the hair strands, 3 the nearest translucent layer, 4 the volume, 5 the translucency volume. Only 1 and 3 are drawn yet |
| `sampledLightsVisualizeLightComplexityMaxLights` | `32` | The most lights the list shows, the heaviest first |
| `sampledLightsVisualizeLightComplexityMaxCost` | `32` | The cost the heat map paints red; a lower cost goes through yellow, green and cyan to blue, a pixel with no cost stays grey. 0 paints no heat map |
| `sampledLightsVisualizeLightComplexityFreeze` | `false` | Keeps the list and the lines of the last pixel read, so that the cursor and the camera can move; the heat map is not painted |
| `sampledLightsVisualizeLightComplexityDump` | `false` | Writes the list to the console once each time the option is turned on: name, share and weight, visibility, kind and place or direction of every light |
| `sampledLightsVisualizeLightComplexityHeatmap` | `true` | Paints the heat map; false leaves the image as it is |
| `sampledLightsVisualizeLightComplexityLightColor` | `true` | The lines and symbols in the light's own colour, dimmed when it was not seen; false: green, dark green when not seen |
| `sampledLightsDebug` | `0` | The input the debug prints speak of: 1 the surfaces, 2 the volume, 3 the translucency volume, 4 the hair strands, 5 the nearest layer |
| `sampledLightsDebugTraceStats` | `false` | With `sampledLightsDebug`, the count of rays each trace method got, written at the right of the image |
| `sampledLightsDebugCursorX`, `sampledLightsDebugCursorY` | `-1` | The pixel the prints inspect; -1 is the middle of the image |
| `subsurfaceDebugPixel` | `false` | At full resolution, the lighting of the pixel under the cursor written as a table: its lit colour, the diffuse and specular light rebuilt from it, its profile, base colour, tint and scattered light, and the colour the recombine makes |

```js
// The frames each pixel's light has accumulated, the tiles of the classification, and the subsurface pixel at the middle.
const world = createWorld('viewer', {
  sampledLights: true,
  sampledLightsVisualize: 7, // the frames accumulated
  sampledLightsVisualizeTileClassification: 1,
  sampledLightsDebug: 1,
  sampledLightsDebugTraceStats: true,
  subsurfaceDebugPixel: true,
  sampledLightsDebugCursorX: 960,
  sampledLightsDebugCursorY: 540,
})
world.diagnostic.mode = 'subsurface-profiles'
```

The light complexity view lists the lights of the cell under the debug cursor and paints the cost of sampling every pixel. The list is read back a few frames after the pixel is asked, and the lights are named by their ids.

```js
// The lights of the pixel at (960, 540), the heaviest eight, and the heat map red from a cost of 16.
const world = createWorld('viewer', {
  sampledLights: true,
  sampledLightsDebugCursorX: 960,
  sampledLightsDebugCursorY: 540,
  sampledLightsVisualizeLightComplexityMaxLights: 8,
  sampledLightsVisualizeLightComplexityMaxCost: 16,
})
world.diagnostic.mode = 'sampled-lights-complexity-opaque'
```
