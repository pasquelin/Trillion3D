# Transparent surfaces

Transparent meshes: GPU frustum verdict (`blend/verdict/verdictWgsl.ts`), ordered farthest first on
the GPU (`blend/order/order.ts`), lit with the lit passes' lists (`src/blend/lighting.ts`). A
transmissive surface is sorted and lit among them, composed as a thin translucent layer
(`blend/transmission/transmitWgsl.ts`), and refracts the opaque scene through one distortion pass
before every translucent layer (`src/blend/distortion.ts`).

**The separate translucency** (`blend/translucency.ts`, `blend/draw.ts`). Layers are drawn over the
opaque depth into two targets of the lit image's size and format (`sceneBlends`; a texel each without),
counted by the budget (`translucencyBytes`).

- Translucency target: the layers' added colour, in alpha the transmittance; cleared to black and 1.
  normal and alphaComposite multiply it by `1 − a`, additive leaves it, alphaHoldout multiplies by
  `1 − a` and cuts the colour behind (`BLEND_EQUATIONS`).
- Modulation target, cleared to white: multiplied by multiply and subtractive layers, each in its own
  pass (`drawModulation`), and, under the dual blend, the transmissive layers' transmittance
  (`DUAL_MODULATE`, `fsTransmitModulate`), the colour added on the translucency target (`DUAL_BLEND`).
  No modulating layer: no pass, a white texel read (`modulated`, `groupBare`).

Layers compose onto the depth of field's image, or the lit one, before the temporal pass:
`scene · modulation · transmittance + light` (`layersOver`). The depth of field's recombine does it as
it writes (`ResolveFrame.layers`, `dofRecombineMainWgsl.ts`: `TranslucencyTargets.phase` `fused`);
else two draws (`composeLayers`, `composeTranslucency`) onto the lit image, composed in its own pass
only where the next image's reflections keep it (`keepsLitImage`). The lit image's alpha (unless
`propagateAlpha`) is multiplied by the layers' transmittance and the visible background. Particles
are layers of the same targets (`drawParticles`, `particleTargets`), smoke alphaComposite, fire
additive (`BLENDS`); a pool: full-size targets (`drawsTranslucency`). Views' see-through edges
(`encodeXray`) draw into the lit image.

**Double-sided blends** (`blend/plan/plan.ts`, `sidesOf`). A see-through `side: 'double'` surface is one
plan entry on the non-culling pipeline; `twoSidedPasses` (`false` by default,
`PageSurface.twoSidedPasses`) plans two entries, back then front faces, culled in the vertex stage
(`planVertexCull`).

**The three passes** (`blend/translucencyPasses.ts`, `translucencyPhase.ts`). `Material.translucencyPass`
(`ParticlePoolSpec.translucencyPass` for a pool):

- `'afterDepthOfField'` (default): composed over the image after the depth of field;
- `'beforeDepthOfField'`: composed onto the scene before it, so it blurs;
- `'afterMotionBlur'`: drawn into a second set of targets (`TranslucencyTargets.late`,
  `drawsLateTranslucency`), composed over the image the temporal pass and motion blur leave: by the
  last motion blur as it writes (`lateOver`, `MotionBlurParams.outputs.y`); with no blur, into its own
  image (`encodeResolvedEffects`, `composeLateImage`); with no effect or chain, at once
  (`composeLateOnto`).

With the depth of field drawn on the image (`splitsTranslucency`), the pass-before layers are drawn
first and composed at once, the others after it; a pass with no layer is not drawn. The plan is drawn
once per set (`encodeBlend`, `layerDraws`): an item of another pass expands no instance
(`expand/expansionViews.ts`, pass bit in `draws[item].w`); an empty slot is not encoded
(`slotMayDraw`); particle pools are split by pass; `composeLayers` (`encodeBlend.ts`) composes.

**What the temporal pass reads of the translucency.** Colour before the layers is
`(composed − light) / transmittance`; the lumas ratio `light / (light + before · transmittance + 0.0005)`
in perceptual space (`post/taa/translucencyWgsl.ts`) trims the thin geometry's relaxation weight, from
0.05 to 0.6, and, past `temporalThinGeometryRejectTranslucency`, keeps the translucency bit alone in the
coverage history (`thinGeometryWgsl.ts`). Flicker discounts by `1 − transmittance`;
shading rejection (`rejectionWgsl.ts`) uses the colour before the layers.

**The clouds on the translucent surfaces, per vertex.** Two vertex readings: the clouds' shade, where
the project switch `cloudShadowOnTranslucent` is on (off by default, read at session opening,
`createWebgpuBlendState`), and the cloud image, for a `cloudFog` material.

- A program reading either (`cloudVertex`: switch on, or scene holds such a surface,
  `BlendModePipelines.cloudVertex`) reads the forward directional light's map at each vertex
  (`cloudShadeAt`) and the cloud image (`cloudFogOver`), passed to the fragment stage as two extras
  (`blend/vertexExtras.ts`, `blend/cloudVertexText.ts`: shade one lane, layer four). The struct's
  thirteen locations become fifteen (sixteen with the front-face flag); rank, diagnostic word and
  record's rank share `VSOut.words`.
- Each fragment entry takes the shade first (`cloudShadeVertex`); the light of the forward rank
  (`DirectLights.forwardRank`, light buffer header) is multiplied by it, the others unshaded;
  a `CLOUD_FOG_MODEL_BIT` material lays the layer over its fog (`rgb * transmittance + light`).
- A feature that is off gives its neutral value (shade 1, layer `(0, 0, 0, 1)`) from a stand-in
  (`cloudShadowStandIn`, `cloudFogStandIn`): bindings `BLEND_CLOUD_SHADE_BINDINGS`,
  `BLEND_CLOUD_FOG_BINDINGS`, vertex stage only (`translucentCloudVertex`, `blend/cloudVertex.ts`).
  A program reading neither: thirteen locations, no code.

**The cloud image.** For a `cloudFog` material the vertex stage reads the image's cloud image (fog laid
on it when `cloudFogLateOnTranslucent` asks): the colour at the vertex's screen place and the least of
the four front depths a gather there would read; a vertex further than the front by
`cloudSoftBlendingDistanceOnTranslucent` or more is under the cloud in full, before it the cloud fades
in. Direct-traced clouds (orthographic, or `cloudRenderTarget` off) leave no image.

**The forward directional light.** One directional light serves this shade and the volumetric fog
(the fog volume's `sunRank`): the highest `forwardShadingPriority` (whole number at least 0, 0 by
default, a light field and a field of the sky's `sun` part); among equals, the greatest squared declared colour (with temperature, before the air
tints it) times intensity, the first added. The light store re-chooses on add, change or removal of a
directional light and writes its rank plus one into the light buffer header's second word (`LIGHT_HEADER_FORWARD`);
`SceneLightStore.forwardDirectionalSlot` is its rank. The analytic fog's lobe uses the air's first
light (`fogSun.ts`).

```js
const world = createWorld('viewer', { cloudShadowOnTranslucent: true }) // the project switch, at the session's opening
// The sun has a cloud shadow map (`castCloudShadows`, off by default; the sky quality's
// `cloudShadowMap` is on) and lets it shade the surfaces (`cloudShadowOnSurfaceStrength`, above 0; 1
// by default): the translucent surfaces then follow the forward directional light, the sun here.
world.scene.sky = { clouds: true, sun: { castCloudShadows: true, cloudShadowOnSurfaceStrength: 1 } }
```

**The fog of a blended surface.** Per vertex by default (`blend/cloudVertexText.ts`), laid far to near:
height or distance fog and haze (`fogLaidFar`, `lighting/fogCompose.ts`), local fog volumes of the
vertex's tile (`fogLocalVertex`, `fogTiles`), the clouds where `cloudFog`, into the extra `fogLayer`;
the fragment lays the fog's volume over it (`fogVolumeOver`) in `blendFog`. The record's `fogPerPixel`
flag (`MATERIAL_FLAG`; `computeFogPerPixel`, always for single-layer water) selects the per-pixel path
(`materialFlagOf`). `fogVertexOf` (`blend/pipelines.ts`): without a per-vertex fog surface, programs
compile with `fogVertexed` false and no fog lane. `clusterIdentity`: cluster identity words, one buffer.

**The translucency lighting volume.** A blended surface whose material says `translucencyLighting`
other than `'forward'` (default of a material made in code `'volumetricNonDirectional'`; a blended
scene-file material is imported as `'volume'`, a transmissive one as `'forward'`,
`scene/host/prepared/materials.ts`) (`'volume'`, `'volumetric'`, `'volumetricNonDirectional'`,
[SDK.md](../sdk/lights/a-see-through-surface-lit-from-the-translucency-lighting-vol.md#a-see-through-surface-lit-from-the-translucency-lighting-volume))
takes its direct light from a volume built each image (`lighting/translucency/`).

- The mode is two bits of the material's record (`materials/surface/surfaceModelWord.ts`,
  `TRANSLUCENCY_LIGHTING_MODEL_SHIFT`), then of the item's flags (`translucencyLightingFlags`,
  `lighting/translucency/modeWgsl.ts`), read by the fragment (`translucencyLightingOf`).
- Pipeline by lighting program (`blendLightingOf`: forward, volume, lightless, unlit; `BLEND_LIGHTING`).
- A scene whose blended surfaces are all forward, or none translucent or additive, builds
  `BlendModePipelines.translucencyVolume` false (the volume lights those two blending modes alone, and
  only default lit and thin subsurface surfaces; others get no declared light, `blendLightsOf`): no volume code (`translucencyVolumeOf`, `blend/pipelines.ts`), no pass
  (`encodeTranslucencyVolume`, `lighting/translucency/frame.ts`).
- Asking for the volume after opening rebuilds programs (`grantGraphs`; a layout field,
  `session/world/repaint.ts`).

One compute pass each image (`lighting/translucency/gpu.ts`), after the shadow maps and the opaque
surfaces (`frame/render/surfaceLighting.ts`), before the blends, in four steps.

1. Cascades are placed (`bounds.ts`): the sphere holding the frustum stretch the cascade covers
   (inner: camera to its distance; outer: from there to its own), 45 degrees and a square view unless `translucencyVolumeAdaptToPerspective` takes the camera's own (rounded up to a multiple
   of `translucencyVolumeFovSnap`), its centre snapped to a multiple of two radii over the cells a side.
2. The lights each cascade reaches are listed on the CPU (`cullLights`: directional lights in both, a
   local light by its range's sphere against the cascade's box).
3. Injection (`injectWgsl.ts`), a thread a cell of either cascade, adds the ambient cubemap's mean
   colour (`ambientCubemap`) to cells with no harmonic, and each listed light's colour over π, times
   fall-off, times its shadow at the cell (one virtual shadow map sample; no page reads lit), to a
   two-band spherical harmonic: the constant band of each colour, in alpha the sun's share reaching the
   cell, and three linear terms along the light's direction (luminance alone). The sun takes its light
   function, the clouds' shade and the air's tint. In the outer cascade shadow and fall-off fade to the
   border over a tenth of its size. Light is times the pre-exposure.
4. The temporal filter, where `translucencyVolumeTemporal` is on, blends each cell with the previous
   volume at the same point (none outside the previous boxes, on a camera cut, or in the outer border
   cells), by `translucencyVolumeHistoryWeight`, at this pre-exposure. The blur
   (`translucencyVolumeBlur`): mean of 3 × 3 × 3 neighbours weighed 1, 2, 1 per axis, edge held; it
   packs the volume the surfaces read.

Where `translucencyVolumeMarkVoxels` is on, lights and filters work over the cells the surfaces read
alone: the radiance cache's marking pass (`radianceMarkWgsl.ts`, drawn regardless,
`drawHeldVolumeMarks`) also marks each fragment's eight trilinear cells per cascade
(`prepareTranslucencyVolumeMarks`), dilated to the cube's corners, gathered into a list; injection is
dispatched indirectly over it; unmarked cells filter to zero.

A fragment reads it (`translucencyVolumeLight`, `readWgsl.ts`): its point, moved by a blue noise where `translucencyVolumePositionOffsetRadius` is above 0, is read in both cascades by eight
trilinear loads, the inner fading out over the sixth of its size at its edge. The light is the
constant band plus the linear bands along the normal (`volume`, `volumetric`) or the constant band alone
(`volumetricNonDirectional`), at least zero, times the diffuse colour (none for a metal) over the
pre-exposure. It replaces the declared lights' sum; bounce, environment and emission are as for a
forward surface; `volumetric` and `volumetricNonDirectional` drop the reflection term (`blendMedium`,
`blend/shader.ts`).

**How the volume fits the fragment stage's limits.** One 3D texture of `rgba32uint`, both cascades
stacked along the depth, four words a cell (ambient four channels, directional three, half floats),
read by `textureLoad` as a read-only storage texture (`BLEND_BINDINGS.translucencyVolume`): none of the
sixteen sampled textures or eight storage buffers, the fourth of four storage textures
(`gpu/core/stageLimits.test.ts`). The cascades' boxes and read
words are fields of the blend's view block (`BlendView.volumeCorner`, `volumeScale`, `volumeRead`); a
view making none binds a one-cell stand-in and writes 0 cells a side (black).
Injection and filters (`injectWgsl.ts`, `filterWgsl.ts`): groups of four cells a side; injection binds
five storage buffers, two storage textures, three sampled, four uniform.
 A refused
memory budget (`ledgerAdmitted`, `createHeldTextures`, `gpu/core/heldTextures.ts`) reads black.

```js
const world = createWorld('viewer', { translucencyVolumeDim: 32 })
// A pane of glass lit by the volume: the sun and the lamps reach it through their shadow maps, once for the cell,
// not once for every light at every pixel.
const glass = material.meshStandard({
  transparent: true,
  opacity: 0.3,
  translucencyLighting: 'volume',
})
```

**The translucency global illumination volume.** Every see-through surface's indirect light is one
filtered fetch of a grid fitted to the view (`lighting/translucencyGi/`). A cell is `translucencyGiGridPixelSize` pixels (32) across the image,
slices on the logarithm of the distance, `log2(depth · translucencyGiGridDistributionLogZScale +
translucencyGiGridDistributionLogZOffset) · translucencyGiGridDistributionZScale`, out to
`translucencyGiEndDistance` (80 m): 60 × 34 × 26 cells at 1920 × 1080 (`translucencyGiGrid`,
`layout.ts`). One compute pass each image, after the screen probes and radiance cache
(`encodeTranslucencyGi`, `frame.ts`):

- cells worth tracing: those whose nearest slice lies in front of the farthest depth of the pyramid in
  their footprint (`giVisible`);
- a thread a cell traces `translucencyGiTracingResolution`² cones (3 × 3) from a Halton-jittered point
  of the cell, moved forward where the depth lies just behind it (`traceCones`, `traceWgsl.ts`): the
  global distance field marched from the point, no bias, no dither, to where the radiance cache is
  trusted, the surface cache read at the hit (`SP_MARCH`), the cache's light beyond (`spFarOf`);
- cells' probes are marked (`markCells`, `MarkSurface.markers`, only where the cache is read)
  `translucencyGiRadianceCacheClipmapBias` (3) cascades coarser than the cell's;
- three separable Gaussian passes (`filterX`, `filterY`, `filterZ`), stochastic rounding to half float
  (`giQuantize`);
- integration into two-band harmonics, blended with the reprojected previous volume (`integrateCells`).

One `rgba16float` 3D texture, ambient light in the first half of its slices and directional light in
the second, two textures taking turns as history; a fragment reads it through a trilinear sampler
(`translucentGiIrradiance`, `readWgsl.ts`), the last half slice fading to the sky light's irradiance,
which is all it reads where no volume is made (screen probes cast none, no blended surface, a
non-perspective camera, `translucencyGi` off); a thin two-sided surface's back reads it along the
opposite normal, a medium the constant band alone. Blend programs spend 16 of 16 sampled textures, 4 of
16 samplers, 9 of 12 uniform buffers (`gpu/core/stageLimits.test.ts`). Behind the front surface,
reflections use the environment (`reflectionEnvironmentOf`).
