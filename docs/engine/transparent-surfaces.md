# Transparent surfaces

The engine culls transparent meshes by a frustum verdict on the GPU (`blend/verdict/verdictWgsl.ts`), orders them
farthest first on the GPU (`blend/order/order.ts`) and lights them with the lit passes' lists
(`src/blend/lighting.ts`). A transmissive surface is sorted and lit among them, composed as
a thin translucent layer (`blend/transmission/transmitWgsl.ts`), and refracts the opaque scene through
one distortion pass drawn before every translucent layer (`src/blend/distortion.ts`).

**The separate translucency** (`blend/translucency.ts`, `blend/draw.ts`). The translucent layers are not drawn into the
lit image: they are drawn over the opaque depth into two targets of their own, the same size and format as the lit
image, made with the frame's targets whenever the scene holds a translucent surface (`sceneBlends`; a texel each
without) and counted by the budget (`translucencyBytes`). The translucency target holds what the layers add in its
colour and, in its alpha, the transmittance — the share of the scene behind them that shows through —, cleared to
black and 1 by the pass: normal and alphaComposite multiply it by `1 − a`, additive leaves it, alphaHoldout multiplies it by
`1 − a` as normal does and cuts away the colour behind it (`BLEND_EQUATIONS`, one table for every target). The modulation
target, cleared to white, holds what the layers that filter the scene multiply it by: multiply and subtractive, each
in a pass of its own beside the blend pass (`drawModulation`), and, under the dual blend, the transmissive layers'
transmittance (`DUAL_MODULATE`, drawn by `fsTransmitModulate`, which reads no light for a colour its blend drops),
the colour of the dual blend added on the translucency target (`DUAL_BLEND`), its alpha left as it is. An image
none of whose layers modulates the scene encodes no pass for it, as a translucency pass with nothing to draw is
skipped: the target is left as it was and the composition reads a white texel in its place (`modulated`,
`groupBare`). The depth of field reads the lit image without them, so no layer of the default pass is
blurred; the image they compose onto is that of the depth of field, or the lit one without it, before the
temporal pass: `scene · modulation · transmittance + light` (`layersOver`). The depth of field's recombine does it as it
writes its output (`ResolveFrame.layers`, `dofRecombineMainWgsl.ts`: `TranslucencyTargets.phase` `fused`), the layers
read as they are drawn, at the render size; with none, or where the recombine drew nothing, the composition does it in
two draws (`composeLayers`, `composeTranslucency`) onto the lit image — which is also composed, in a pass of its own,
only where the next image's reflections keep it (`keepsLitImage`). The lit image's alpha — read by nothing, its colour being read as it is, unless
`propagateAlpha` is on — is multiplied by the layers' transmittance and by the background the modulation leaves visible,
the mean of its three channels. The particles are layers of the same
targets (`drawParticles`, `particleTargets`), their smoke an alphaComposite layer and their fire an additive one
(`BLENDS`); a session that holds a pool makes the targets full size as one that holds a blend does
(`drawsTranslucency`). The see-through views' edges (`encodeXray`), an overlay, still draw into the lit image, over
the layers composed at once (an image with no effects has no depth of field to wait for).

**Double-sided blends** (`blend/plan/plan.ts`, `sidesOf`). A see-through surface of `side: 'double'` is one plan entry on the
pipeline that culls nothing, one draw, as a two-sided surface is in every pass of the image; the material's `twoSidedPasses`
(`false` by default, `PageSurface.twoSidedPasses`) plans two entries instead, its back faces then its front faces, which
share one pipeline that culls nothing and apply the cull in the vertex stage (`planVertexCull`), so that the blend of a
closed shape composes far side then near side.

**The three passes** (`blend/translucencyPasses.ts`, `translucencyPhase.ts`). A see-through surface names the pass of
the image it is drawn in: `Material.translucencyPass` (`ParticlePoolSpec.translucencyPass` for a pool),
`'afterDepthOfField'` by default, apart from the scene and composed over the image once the depth of field has read it,
`'beforeDepthOfField'`, composed onto the scene before the depth of field, which blurs it with the scene it lies in, or
`'afterMotionBlur'`, drawn into a second set of targets (`TranslucencyTargets.late`, made while the scene holds such a
layer, `drawsLateTranslucency`) and composed over the image the temporal pass and the motion blur leave,
read bilinearly where the image is the display's. The last motion blur lays it as it writes its image — in the
last pass of its filter (`lateOver`, `MotionBlurParams.outputs.y`), so that the half-size image it writes beside
carries it too —; where no blur is drawn (off, or a still image) it is composed into an image of its own
(`encodeResolvedEffects`, `composeLateImage`), the temporal pass's output being its history, which is never
written to; the chain then makes the half-size image itself. Where the image shows no effect or runs no chain,
it is composed at once (`composeLateOnto`). With the depth of field drawn on
the image (`splitsTranslucency`), the layers of the pass before it are drawn first and composed onto the lit image at
once, the others after, left to the composition after the depth of field; a pass with no layer is not drawn, and a lone
pass draws every layer. The same plan is drawn once for each set (`encodeBlend`, `layerDraws`): the expansion runs once for each
draw over the same sorted plan, an item whose pass the draw does not keep expanding no instance (`expand/expansionViews.ts`,
the view's filter against the item's pass bit in `draws[item].w`), so each draw has its own arguments and its own instances and
the vertex stage processes no vertex of another pass's item; a slot the CPU knows empty for the view is not encoded
(`slotMayDraw`); the particle pools are split by their pass. The responsiveness pass reads the view of the responsive items
among the draw's alone. Without the depth of field and the late pass one draw
keeps everything. The image composes its layers in one place (`composeLayers`,
`encodeBlend.ts`): the temporal pass measures the scene before the first layers laid on it (once an image), then the
target is composed — onto the lit image for the pass before the depth of field, after the depth of field's pass (or at
once where the image shows no effects or the chain does not follow) for the others.

**What the temporal pass reads of the translucency.** The image it resolves is composed, so the share of a texel's
luma the layers make is rebuilt from it and from the translucency target of the image: the colour before the layers is
`(composed − light) / transmittance`, and the ratio `light / (light + before · transmittance + 0.0005)` of the lumas in
the perceptual space (`post/taa/translucencyWgsl.ts`) trims the thin geometry's relaxation weight, from 0.05 to
0.6, and, past `temporalThinGeometryRejectTranslucency`, keeps the translucency bit alone in the coverage history
(`thinGeometryWgsl.ts`); the flicker measure takes its luma from the colour before the layers and discounts a texel
by the greater of the change the layers made to its colour in the measurement space and `1 − transmittance`, and the
shading rejection composes the colour before the layers with the layers' 3×3 blur (`rejectionWgsl.ts`). A texel of an
image composed with no layers reads no light and a transmittance of 1.

**The clouds on the translucent surfaces, per vertex.** The clouds' shadow maps shade the opaque
surfaces, and the clouds are composed over the lit image before the transparents are drawn, so a
translucent surface is shaded by the clouds, and drawn behind them, only through two readings made
at each vertex of its programs: the clouds' shade, where the project switch
`cloudShadowOnTranslucent` is on (off by default, read once when the session opens, as the clip
plane's is, `createWebgpuBlendState`), and the cloud image, for a surface whose material has
`cloudFog`. A program that reads either (`cloudVertex`: the switch is on, or the scene holds such a
surface, `BlendModePipelines.cloudVertex`) is made with the vertex stage reading both, the map of
the forward directional light (below) at each vertex (`cloudShadeAt`) and the cloud image
(`cloudFogOver`), and handing them to the fragment stage as two extras of its output, named lanes
allocated from one table (`blend/vertexExtras.ts`, `blend/cloudVertexText.ts`: the shade one lane,
the layer four): no lane of another value is borrowed. The struct's thirteen locations, which every
program has, become fifteen, and with the front-face flag they are the sixteen a fragment stage is
granted; the triangle's rank, the diagnostic word and the record's rank share one flat member
(`VSOut.words`) to make the room. Each fragment entry takes the shade first (`cloudShadeVertex`) and
the light of the forward rank, which the light buffer's header names (`DirectLights.forwardRank`),
is multiplied by it, the others unshaded; the fragment lays the layer over the fog it computes
itself (`rgb * transmittance + light`) for a surface that wears the material's bit
(`CLOUD_FOG_MODEL_BIT`). A feature that is off gives its neutral value (a shade of 1, the layer `(0,
0, 0, 1)`) from the stand-in bound in its place: the blend group's layout holds both reads, whatever
the program, the shade's block, map and sampler and the cloud image's block, colour, depth and
sampler (`BLEND_CLOUD_SHADE_BINDINGS`, `BLEND_CLOUD_FOG_BINDINGS`), read by the vertex stage alone —
the fragment stage's sixteen sampled textures and eight storage buffers are spent —, and one place
makes what they are bound with, once an image (`translucentCloudVertex`, `blend/cloudVertex.ts`):
the forward light's map and block, the image the view drew, or the stand-ins of the device
(`cloudShadowStandIn`, `cloudFogStandIn`, each made once for a device: a runtime makes no buffer of
its own while no program reads the clouds). A program that reads neither holds none of the code: its
text is the text it was, thirteen locations.

**The cloud image.** For a surface whose material has `cloudFog` the vertex stage reads the cloud
image of the image (the rebuilt one, or the traced one in the sizes that do not rebuild; with the
fog laid on it when `cloudFogLateOnTranslucent` asks): the colour at the vertex's place on the
screen, and the least of the four front depths a gather there would read, which is the cloud's
front; a vertex further from the eye than the front by the soft blending's length
(`cloudSoftBlendingDistanceOnTranslucent`) or more is under the cloud in full, before it the cloud
fades in. A view that traces its clouds directly (an orthographic one, or `cloudRenderTarget` off)
leaves no image to read.

**The forward directional light.** Of the directional lights of a scene one is chosen for the readers
that take a single one: this shade, and the volumetric fog's light (the fog volume's `sunRank`). It is
the light of the highest `forwardShadingPriority` (a whole number of at least 0, 0 by default, a light
field and a field of the sky's `sun` part); of equal priorities, the one whose declared colour — with
its temperature, before the air tints it, so a sun reddened at the horizon keeps its place — times its
intensity has the greatest squared length, the first added of equals. The light store chooses again
when a directional light is added, changed or removed, and writes its rank plus one into the second
word of the light buffer's header (`LIGHT_HEADER_FORWARD`), `SceneLightStore.forwardDirectionalSlot`
being its rank. The analytic fog's lobe keeps its own sun, the air's first light
(`fogSun.ts`).

```js
const world = createWorld('viewer', { cloudShadowOnTranslucent: true }) // the project switch, at the session's opening
// The sun has a cloud shadow map (`castCloudShadows`, off by default; the sky quality's
// `cloudShadowMap` is on) and lets it shade the surfaces (`cloudShadowOnSurfaceStrength`, above 0; 1
// by default): the translucent surfaces then follow the forward directional light, the sun here.
world.scene.sky = { clouds: true, sun: { castCloudShadows: true, cloudShadowOnSurfaceStrength: 1 } }
```

**The fog of a blended surface.** Per vertex by default (`blend/cloudVertexText.ts`), laid from the farthest layer to the nearest: the vertex stage works out the height or distance fog with the haze behind it (`fogLaidFar`, `lighting/fogCompose.ts`), the local fog volumes of the tile the vertex lies in over them (`fogLocalVertex`: the vertex reads the lists of the volumes, `fogTiles`, visible to its stage), the clouds over both where `cloudFog`, into the one extra `fogLayer`; the fragment lays the fog's volume over it (`fogVolumeOver`) in `blendFog`, the one fog the colour layers, the alpha holdout and the thin layers all take, worked out once. The material record's `fogPerPixel` flag (`MATERIAL_FLAG`; `computeFogPerPixel`, and always for single-layer water) selects the per-pixel path, read by the fragment from the surface's record (`materialFlagOf`; the record's model word has no bit left). `fogVertexOf` (`blend/pipelines.ts`) says whether the scene holds a surface that takes its fog per vertex: without one the programs compile with `fogVertexed` the constant false and no fog lane. The vertex stage reads the light buffer, the fog's cubemap and the lists of the volumes, so those bindings are visible to it; the cluster identity words the diagnostic views colour by sit behind the spans in one buffer (`clusterIdentity`), the vertex stage holding the eight storage buffers WebGPU guarantees.

**The translucency lighting volume.** A blended surface whose material says `translucencyLighting` other
than `'forward'` (the default of a material made in code is `'volumetricNonDirectional'`; a blended scene-file material is imported as `'volume'`, a transmissive one as `'forward'`, `scene/host/prepared/materials.ts`) (`'volume'`, `'volumetric'`, `'volumetricNonDirectional'`, [SDK.md](../sdk/lights/a-see-through-surface-lit-from-the-translucency-lighting-vol.md#a-see-through-surface-lit-from-the-translucency-lighting-volume))
takes the direct light from a volume built each image (`lighting/translucency/`) in place of walking the lights in its
fragment. The mode is two bits of the material's record (`materials/surface/surfaceModelWord.ts`,
`TRANSLUCENCY_LIGHTING_MODEL_SHIFT`), which the blend vertex stage carries to two bits of the item's flags
(`translucencyLightingFlags`, `lighting/translucency/modeWgsl.ts`) and the fragment reads back
(`translucencyLightingOf`); a layer is drawn by the pipeline of the lighting program that lights it (`blendLightingOf`: forward, volume, lightless, unlit; part of the plan rank and the pipeline's `BLEND_LIGHTING` constant, which folds the other programs' light code away: the declared lights and their shadow traces only in the forward one, the volume's read in the volume one, the lit path in none of the unlit one); a scene whose blended surfaces are all forward, or none translucent or additive, builds `BlendModePipelines.translucencyVolume`
false (the volume lights those two blending modes alone, and only default lit and thin subsurface surfaces: a volume mode lights every other layer with no declared light, `blendLightsOf`; the mode alone says it, whatever the blending mode): the programs hold none of the volume's code (`translucencyVolumeOf`, `blend/pipelines.ts`), and no pass, texture or
bind group is made (`encodeTranslucencyVolume`, `lighting/translucency/frame.ts`). A surface that asks for the volume after
the session opened is drawn by programs built again (`grantGraphs`), and its field is a layout one (`session/world/repaint.ts`).

The image builds it in one compute pass (`lighting/translucency/gpu.ts`), after the shadow maps it reads and the opaque surfaces are lit (`frame/render/surfaceLighting.ts`), and before the
blends, in four steps. (1) The cascades are placed (`bounds.ts`): the sphere that holds the stretch of the view's
frustum the cascade covers (the inner one from the camera to its distance, the outer one from there to its own), its far corners weighed ten times the near ones, a field of 45 degrees and a
square view unless `translucencyVolumeAdaptToPerspective` takes the camera's own (rounded up to a multiple of
`translucencyVolumeFovSnap`), its centre snapped to a multiple of two radii over the cells a side. (2) The lights each
cascade reaches are listed on the CPU (`cullLights`: the directional lights in both, a local light by the sphere
of its range against the cascade's box) into one buffer of light ranks, so that no cell walks a light that cannot reach it.
(3) The injection (`injectWgsl.ts`) runs a thread a cell of either cascade, the two stacked along the depth of one
texture, adds the ambient cubemap's mean colour (`ambientCubemap`: the cube's last mip times its colour, once the cube's mip chain is whole) to the ambient light of every cell with no harmonic, and adds each listed light's colour over π, times its fall-off, times its shadow read at the cell (one sample of the
virtual shadow map, as a blended surface's cheap read; a cell the maps hold no page for reads lit), to a two-band
spherical harmonic: the constant band of each colour and, in the alpha, the sun's share that reached the cell, and
the three linear terms along the light's direction, kept as the colours' luminance alone (the direction of light
has no colour). The cell's point is moved half a cell away from the light so its own cell takes no overblown share; the sun
takes its light function, the clouds' shade and the air's tint; a local light its light function. In the outer
cascade the shadow and the fall-off fade to the border over a tenth of its size, so that the border cells, which light
every surface past the volume, hold the sun unshadowed and no local light. The light is written multiplied by the
image's pre-exposure, which keeps the half floats' range at any exposure. (4) The temporal filter, where
`translucencyVolumeTemporal` is on, blends each cell with the cell of the volume of the image before at the same point
(the image before's boxes, a cell the point falls in; none where it lies outside them or the camera cut; the outer
cascade's border cells take none), by `translucencyVolumeHistoryWeight`, the history brought to this image's
pre-exposure by the ratio of the two; what it writes is the history of the next image, two volumes taking turns. The
blur (`translucencyVolumeBlur`) then makes each cell the mean of its 3 × 3 × 3 neighbours weighed 1, 2, 1 along each
axis, the cascade's edge held, over the temporal filter's volume where that ran, and packs it into the volume
the surfaces read.

Where `translucencyVolumeMarkVoxels` is on, the lights and the filters work over the cells the surfaces read alone. The pass that draws the
blended surfaces once more to mark the radiance cache's probes (`radianceMarkWgsl.ts`) also marks, for each fragment kept (a medium's included), the
eight cells of the trilinear fetch in each cascade it reads, in a texture emptied before (`prepareTranslucencyVolumeMarks`); that pass is drawn
whether or not the radiance cache marks (`drawHeldVolumeMarks`). The marks are dilated to the corners of the cube round each cell, gathered into a
list, and the injection is dispatched indirectly over that list; the filters write zero in an unmarked cell, and the temporal filter has no
history when the image before marked none.

A surface reads the volume in its fragment (`translucencyVolumeLight`, `readWgsl.ts`): its point, moved by a blue
noise of the pixel and the image where `translucencyVolumePositionOffsetRadius` is above 0, is read in the inner
cascade and in the outer one, each by eight loads blended trilinearly (the cell held to the cascade, as a clamped sampler
would), the inner one counting in full inside its box and fading to nothing over the sixth of its size at its edge. The
light is the constant band plus the linear bands along the normal (`volume`, `volumetric`) or the constant band alone
(`volumetricNonDirectional`), never below zero, times the surface's diffuse colour (none for a metal) over the pre-exposure.
It replaces the declared lights' sum; the bounce, the environment and the emission are added as for a forward surface, and
`volumetric` and `volumetricNonDirectional` drop the reflection term (`blendMedium`, `blend/shader.ts`).

**How the volume fits the fragment stage's limits.** The volume is one 3D texture of `rgba32uint`, both cascades
stacked along the depth, four words a cell (the ambient light's four channels and the directional light's three, half
floats), read by `textureLoad` as a read-only storage texture (`BLEND_BINDINGS.translucencyVolume`): it spends none
of the sixteen sampled textures nor of the eight storage buffers the blend's fragment stage already holds, and is the
fourth and last of its four storage textures (`gpu/core/stageLimits.test.ts`). The cascades' boxes and the
read words are three more fields of the blend's view block (`BlendView.volumeCorner`, `volumeScale`, `volumeRead`), which no
program that does not read the volume touches; a view that makes none binds a one-cell stand-in and writes 0
cells a side, which the fragment reads as black. The injection and the filters are compute programs of their own
(`injectWgsl.ts`, `filterWgsl.ts`) in groups of four cells a side, within the compute stage's default limits (the injection
binds five storage buffers, two storage textures, three sampled textures and four uniform buffers). The textures follow the cells a side the settings ask, within what the device's 3D textures hold,
and the device's memory budget may refuse them (`ledgerAdmitted`, through `createHeldTextures`, `gpu/core/heldTextures.ts`, which the fog's volume holds its textures with too): the surfaces then read black.

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

**The translucency global illumination volume.** The indirect light of every see-through surface (the blends, the water, the
transmissive stages) is one filtered fetch of a grid fitted to the view (`lighting/translucencyGi/`), in place of the gather of the
world's probes each of its fragments made. The grid is a cell of `translucencyGiGridPixelSize` pixels (32) across the image and
slices on the logarithm of the distance, `log2(depth · translucencyGiGridDistributionLogZScale + translucencyGiGridDistributionLogZOffset)
· translucencyGiGridDistributionZScale`, out to `translucencyGiEndDistance` (80 m): 60 × 34 × 26 cells at 1920 × 1080
(`translucencyGiGrid`, `layout.ts`). Each image, after the screen probes and the radiance cache (`encodeTranslucencyGi`, `frame.ts`),
in one compute pass: the cells worth tracing are the ones whose nearest slice lies in front of the farthest depth of the pyramid
in their footprint, a texel of the depth pyramid two cells across (`giVisible`); a thread a cell traces its
`translucencyGiTracingResolution`² cones (3 × 3) from a point of the cell the image's Halton jitter picks, moved forward where the depth
lies just behind it (`traceCones`, `traceWgsl.ts`; the cells' places and the history's reprojection use the camera's matrices without
the anti-aliasing jitter): the global distance field marched from the point itself, with no bias off a surface and no dither, out to where
the radiance cache is trusted, the surface cache read at the hit (`SP_MARCH`, the screen probes' own march),
the cache's light along the ray for what the march leaves (`spFarOf`); the cache is read, and the probes of the cells are marked
(`markCells`, in the bounce pass the pool marks in, `MarkSurface.markers`, only where the cache is read), `translucencyGiRadianceCacheClipmapBias` (3)
cascades coarser than the cascade that covers the cell, so that the cells that fill the view do not take the probes the surfaces
need; then three separable Gaussian passes along the axes (`filterX`, `filterY`, `filterZ`), the lights written to the half float's precision by a
stochastic rounding (`giQuantize`); then the integration into the two-band
harmonics, blended with the volume of the image before, reprojected through its view-projection (`integrateCells`). The volume is
one `rgba16float` 3D texture, the ambient light in the first half of its slices and the directional light (the linear bands'
luminance) in the second, two such textures taking turns as history; a fragment reads it through a trilinear sampler
(`translucentGiIrradiance`, `readWgsl.ts`), the last half slice fading to the sky light's irradiance, which is also all it reads
where no volume is made (an image whose screen probes cast none, a scene with no blended surface, a camera that is not a
perspective, `translucencyGi` off); a thin two-sided surface's back reads it along the opposite normal, and a material lit as a
medium takes the constant band alone. The volume takes the sampled texture the world's probes' atlas held in the blend programs
(16 of 16 sampled textures, 4 of 16 samplers, 9 of 12 uniform buffers: `gpu/core/stageLimits.test.ts`). What a fragment behind the
front surface of its pixel reflects is the environment through its lobes (`reflectionEnvironmentOf`); the front's is the trace's.
The radiance cache is the world's probes' (the shared path of the reference); a cache of its own for the volume is not made.
