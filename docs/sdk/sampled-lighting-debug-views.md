# Sampled lighting: debug views
Sampled lighting (`sampledLights`) and subsurface scattering have views drawn over the image. Choose
one by `world.diagnostic.mode` or a setting; the effect shown must be on. Every `virtual-shadow-map-*`
mode needs shadows and virtual shadow maps; set it with `await engine.setDiagnostic('<mode>')`.

| Mode | What it shows |
| - | - |
| `virtual-shadow-map-shadow-casters` | box edges of placements the shadows keep as invalidating or that may: red static that deforms, purple dynamic that moves or deforms, blue dynamic whose offset may invalidate; legend lower left; green, cyan, grey classes draw no box |
| `virtual-shadow-map-clipmap-virtual-space` | grey square of the pages the first sun's clipmap has mapped, finest to coarsest level, coloured by address and level (`await engine.setDiagnostic('virtual-shadow-map-clipmap-virtual-space')`) |
| `virtual-shadow-map-shadow-factor` | grey; share of each light reaching the surface: yellow lit, dark blue shadowed, lights added (only `shadowVisualizeLightName` if set); legend |
| `virtual-shadow-map-clipmap-or-mip` | grey; one colour a level: sun clipmap level or local light mip, mixed with share of light |
| `virtual-shadow-map-virtual-page` | grey; virtual page the last ray read, address colour mixed with level colour and share of light |
| `virtual-shadow-map-cached-page` | grey; page state: green kept from last image (one light, or all with `shadowVisualizeCachedPagesOnly`), red both layers redrawn, blue dynamic only, yellow-green kept by force; legend |
| `virtual-shadow-map-ray-count` | rays traced at the pixel against the lights' maximum, green to red |
| `virtual-shadow-map-general-debug` | mean distance to what shadows the pixel, grey (2000 cm = white) |
| `virtual-shadow-map-dirty-page` | grey; red where the page's static layer was written (drawn or cleared) this image, green its dynamic layer |
| `virtual-shadow-map-gpu-invalidated-page` | grey; red where the static layer was invalidated by moved casters, green its dynamic layer |
| `virtual-shadow-map-merged-page` | grey; red where the static layer was drawn this image and merged into the dynamic one, green elsewhere |
| `virtual-shadow-map-overdraw` | grey; times the shadow raster drew the texel this image, inferno, scaled by `shadowVisualizeOverdrawScale` |
| `indirect-diffuse` | indirect light alone: lit surfaces get probe bounce, environment, sky light and ambient cubemap as if diffuse were grey 0.18 (metals too; their colours stay for reflections); no direct light or emission, black elsewhere |
| `rect-light-atlas` | rectangle lights' atlas at mip `rectLightAtlasDebugMipLevel`; green border used slots, red packing horizon lines, yellow free rectangles; figures as text (same as `rectLightAtlasDebug`) |
| `sampled-lights-overview` | shadow caster views side by side in rounded tiles |
| `sampled-lights-shadow-casters` | one ray a pixel from the eye through the scene's triangles (`sampledLightsHardwareRayTracing`), each instance in its own colour under a fixed light; label `Shadow Casters, Materials:0, FarField:0, HairVoxels:0` (`Materials` 1 with `sampledLightsEvaluateMaterialMode` above 0; `HairVoxels` 1 while strand voxels are traced (`sampledLightsHairVoxelTraces`); `FarField` always 0); without rays, surface in grey |
| `sampled-lights-shadow-caster-quality` | surface in grey; orange to red where the ray meets something farther than the surface by more than `sampledLightsVisualizeShadowCasterMissingDistance` (missing caster), blue where nearer by more than `sampledLightsVisualizeShadowCasterPoorDistance` (mismatching); both relaxed at grazing angles |
| `sampled-lights-complexity-opaque` | for the debug cursor pixel, its light-grid cell's lights by sampling weight: a text row each (share, seen before, kind, name) and a line and symbol from the pixel (sphere point, arc spot, two rectangles rectangle, line sun; light under the mouse orange); image grey times blue-to-red sampling cost |
| `sampled-lights-complexity-front-layer` | same for the nearest translucent layer (needs `sampledLightsFrontLayer`) |
| `sampled-lights-complexity-hair-strands`, `sampled-lights-complexity-volume`, `sampled-lights-complexity-translucency-volume` | not drawn yet (modes refused) |
| `subsurface-profiles` | lower right quarter: each pixel's profile: default skin buff, then red, green, blue, magenta, cyan, yellow; 100 dark green, 255 white, other mid grey; number or letter per 8-pixel cell, faded where scattering stays in a pixel; title and list top left |

| Setting | Default | Meaning |
| - | - | - |
| `sampledLightsVisualize` | `0` | Numbered view instead of a mode (wins): 1 overview, 2 shadow casters, 3 their quality, 4 and 5 denoiser overviews, 6 shading confidence, 7 frames accumulated (red invalid, yellow first), 8 upsample mask (yellow: no history), 9 and 10 diffuse and specular demodulation, 11 and 12 light deviation over its mean (red disocclusion, blue spatial filter, violet both), 13 and 14 history deviation (blue above `sampledLightsSpatialHistoryDeviation`), 15 and 16 history clamp (yellow fully rejected) |
| `sampledLightsVisualizeShadowCasterMissingDistance` | `0.5` | Metres a traced surface may lie behind the drawn one before it is missing |
| `sampledLightsVisualizeShadowCasterPoorDistance` | `0.25` | Metres it may lie in front before it is mismatching |
| `sampledLightsHardwareRayTracing` | `true` | Caster views cast one ray a pixel through the scene's triangles. `false`, `rayTracingEnable` off, or no triangles: surface only |
| `sampledLightsEvaluateMaterialMode` | `0` | 0 rays meet every triangle whole; 1 and 2 honour cut-out masks |
| `sampledLightsForceTwoSided` | `true` | Rays meet backs of one-sided triangles; `false` culls them |
| `sampledLightsVisualizeTileClassification` | `0` | Classification tiles: 1 surface, 2 downsampled (3 to 6 hair strands' and nearest layer's, own images); coloured by type, with count table |
| `sampledLightsVisualizeLightComplexity` | `0` | Input of the complexity view instead of a mode (mode wins): 1 surfaces, 2 hair strands, 3 nearest translucent layer, 4 volume, 5 translucency volume; only 1 and 3 drawn |
| `sampledLightsVisualizeLightComplexityMaxLights` | `32` | Most lights listed, heaviest first |
| `sampledLightsVisualizeLightComplexityMaxCost` | `32` | Cost painted red; lower goes yellow, green, cyan, blue; no cost grey; 0 no heat map |
| `sampledLightsVisualizeLightComplexityFreeze` | `false` | Keeps list and lines of the last pixel read; no heat map |
| `sampledLightsVisualizeLightComplexityDump` | `false` | Console dump each time turned on: name, share, weight, visibility, kind, place or direction per light |
| `sampledLightsVisualizeLightComplexityHeatmap` | `true` | Paints the heat map |
| `sampledLightsVisualizeLightComplexityLightColor` | `true` | Lines and symbols in light colour, dimmed when unseen; false: green, dark green unseen |
| `sampledLightsDebug` | `0` | Input the debug prints speak of: 1 surfaces, 2 volume, 3 translucency volume, 4 hair strands, 5 nearest layer |
| `sampledLightsDebugTraceStats` | `false` | With `sampledLightsDebug`, rays per trace method at the image's right |
| `sampledLightsDebugCursorX`, `sampledLightsDebugCursorY` | `-1` | Pixel the prints inspect; -1 is the middle |
| `subsurfaceDebugPixel` | `false` | At full resolution, a table for the cursor pixel: lit colour, rebuilt diffuse and specular light, profile, base colour, tint, scattered light, recombine colour |

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

The complexity view lists the debug cursor cell's lights (named by id) and paints every pixel's
sampling cost; the list is read back a few frames after the pixel is asked.

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
