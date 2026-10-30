# Atmosphere and sky light

The `atmosphere` part of the sky module is a planet's air lit by the sun: a term of the one lighting
model like the fog, whose coefficients and defaults are
`packages/sdk-core/src/scene/core/atmosphere.ts` (an Earth-like planet of 6360 km, air 60 km thick,
ground at `y = groundHeight`, 0 by default, its top at `groundPosition`, `[0, 0]` by default).
Distances of the planet are kilometres, the scene stays in metres. Where it is on,
`scene.background` is not shown.

**Units.** The sun is the brightest directional light of index 0 (`atmosphereSunIndex`, 0 by
default; the second light, below, has index 1) not flagged `atmosphereSun: false` — its colour times
its intensity, each channel weighed by the eye's sensitivity (the sRGB luminance weights, the fog's
sun the same) —, an illuminance `E`. The store holds the sun as lights come and go, whether or not
there is air: a light added replaces it only if brighter; the sun removed gives its place to the
brightest of the others, the first added of equals (a removal moves no one's place in that order); a
light changed is judged again the same way, the sun keeping its place against an equal. The radiance
reaching the eye through the air is `L = E · ∫ T(eye→p) · T(p→sun) · (σs_R φ_R + σs_M φ_M) dt`, plus
the multiply-scattered share, per steradian — the scale a surface reads (`L = albedo / π · E ·
cosθ`), so a 10-lux sun gives the same sky-to-sun ratio at any intensity. A surface is lit by `E ·
T(ground→sun)`, written into the sun's own slot of the light buffer by the store
(`atmosphereSun.ts`; the declared light is untouched, the transmittance integrated on the CPU over
15 samples, once when the air or the sun moves). The sun's disk is drawn at `E · tint / (2π(1 − cos
α))`, `α` its angular radius, `tint` its `sunDiskTint`, times the transmittance toward it and the
rim's softening, each channel held under 64000 after the product and after the image's pre-exposure
(the sky and the disk are multiplied by it once, and an exposed disk is held under 64000 per
channel, the image's sky under 32256). A light's colour is multiplied by that of a black body at its
temperature when `useTemperature` is on (`lightColour`, `scene/light/fields.ts`, the clamp 1000 to
15000 K), before the intensity, in the sun's choice, its illuminance and its light on surfaces.

**Two lights.** The air holds up to two lights, one per index (`SceneLight.atmosphereSunIndex`, 0 or
1, 0 by default), each chosen among the lights that may light the air as the sun is (brightest,
strictly, at adding; the brightest of its index at removal; a light that changes index is removed
and added again). Their directions, illuminances and disks are slots of the atmosphere's block
(`ATMOSPHERE_SLOT`, the second in `second*`, its disk slot's last lane saying that there is one).
Every march of the air (`integrateAir`) adds, per step, the second light's own scattering — its
phase, its planet shadow, its transmittance from the table, its multiple scattering — to the first's,
and, where the ray ends on the ground, its bounce; the sky table, the haze volume, the mean sky at
6 km and the sky light's capture all march both. The multiple-scattering and
transmittance tables depend on the air alone. The sky draws both disks. A surface lit by the second
light receives its illuminance times the transmittance toward it, written into its own slot as the
sun's is. Where there is no second light the marches run their per-light loops once and read nothing
of it. A saved world keeps each light's index (`SavedNode.light.atmosphereSunIndex`, written only
for index 1).

**The tables** (`lighting/atmosphere/`): their sizes and sample counts are the quality settings of the
sky (`AirShape`, `shape.ts`; the defaults the reference's top level), the programs written once for
a shape and made again when the settings make another. A transmittance table (256 × 64, 10 samples,
stored as its square root, in four half floats or, at `transmittanceSmallFormat`, four bytes) and a
multiple-scattering table (32 × 32, 15 samples; from the first 8 of 64 directions over the sphere at
`multiScatterHighQuality`) are built when the air changes; the sky seen from the eye (192 × 104, 4
to 32 samples by distance, the cap no more than 32 times `sampleCountScale`) and the haze volume
(32 × 32 × 16 cells over 96 km, up to 4 samples a slice, twice `sampleCountScale` at most) are built
each image, a thread to a texel, with the mean sky radiance at 6 km (the 64 directions of a grid
jittered by a fixed generator, `sphereSamples.ts`) that the fog takes on. The haze
volume lives in a region of the light buffer of 32768 cells (16384 in 32-bit floats,
`skyTablesFullPrecision`): the slices are cut to fit, and a surface reads its size from the view's
block (`VIEW_SLOT.volume`). Each cell is also stored in a 3D texture of the same cells (`hazeVolume`, `rgba16float`,
`HAZE_VOLUME_FORMAT`, written by `storeHaze` beside the region), which the fog pass samples with the hardware's
filter (`hazeSampledWgsl`) — at `skyTablesFullPrecision` it reads the cells by hand from the region instead, which holds them whole —; the translucent layers, the clouds and the reflections' rays still read the region by hand. A sky pixel is marched, not read from the table, at `skyTableFast` off
(`atmosphereSamplesMin`, `atmosphereSamplesMax`, jittered by the blue noise). The atmosphere's
`inMainView` (on) says whether the view the camera sees draws the air: off, the sky pass writes a black
sky (`skyMain`, `AirFrame.hidden`), the fog pass laying the fog over it as over the background, the haze marched on the opaque surfaces
(`encodeOpaqueHaze`) is not drawn, and the haze volume builder writes the view's block alone with its
kind 0 (`HAZE_VIEW_WGSL`) so that no surface, fog or cloud reads a haze; the sun's light tinted by the
air, the tables and the sky light's capture are as they are.

**Shade on the air.** A directional light that asks for it (`SceneLight.shadowsAir`) shades the air:
at each step of the sky table's march and of the haze volume's, the light's virtual shadow map is read
at the step's place (`airShadow`, `airShadowWgsl.ts`; one sample, as the fog's volume reads the sun's)
and multiplies the light scattered into the ray, the multiply-scattered share left unshaded. The
planet's shadow and the scene's multiply. `atmosphereSampleLightShadowMap` turns the read off.

**Shade the clouds cast on the air.** Besides the opaque scene's shade, each step of the sky table's
march, of the haze volume's, of the sky drawn by march, of the haze on the opaque surfaces, of the haze on
a cloud and of the haze around a capture reads the clouds' shadow maps of the air's two lights
(`cloudShadowOnAir`, `lighting/atmosphere/cloudShadowRead.ts`; the share of the light the cloud leaves,
laid in by the light's `cloudShadowOnAtmosphereStrength`) and, for the first light, the clouds' sky
occlusion map (`cloudSkyOcclusionAt`, `airSkyOcclusion`): the multiply-scattered share of that light is
multiplied by it, `multiScatter(...) · shade.z · scattering`, the second light's left as it is. The
occlusion map holds the sky light's `cloudAmbientOcclusionStrength` already, so it is read whole, with no
strength of its own. The tables that depend on the air alone (the multiple-scattering table, the mean
sky at 6 km) read neither. The sky light's capture marches its sky from its place in the planet's frame (its distance from the
planet's centre, held no lower than an eye, `sceneToPlanet`, as the haze around it) through the same
shade (`skyFaceProgram`, the haze around its place `capture360`), from the maps built this image (the
capture's clouds read `cloudShadowOf` where the capture asks, `captureCloudsOf`, not a copy: a getter, so
that nothing is stale), the stand-in that shades nothing where the scene has no clouds
(`cloudShadowStandIn`).

**The clouds' sky occlusion map** (`modules/sky/clouds/skyOcclusionRun.ts`). Where
`cloudSkyOcclusionWanted` (the quality's `cloudSkyAO` and a sky light, that affects the world, with
`cloudAmbientOcclusion` on), the shadow maps' pass builds it after the lights' maps, whether or not a
light casts one: the cloud shadow trace (`cloudShadowMain`) along the planet's vertical, from a square
round the point of the planet's surface under the camera snapped to `cloudSkyAOSnapKm` (a length of 0 or
less read as 0.1 m), its size set by `cloudAmbientOcclusionExtentKm`, into a map of 512 × the scale
texels a side (at most `cloudSkyAOResolutionMax`), with the sky light's strength, no depth bias,
`cloudSkyAOTraceSamples` samples a ray and no temporal blend; then, with `cloudSkyAOFiltering`, the
hemisphere filter (`skyOcclusionFilterMain`: 16 directions, the optical depth that of the mean of the
transmittances) into a second texture. Its matrix and far depth are in the shadow block (`clipSky`,
`far.z`; a far depth of 0 reads as no occlusion), the map in the sets' `ao`.

**What the clouds read of the air.** Besides the haze surfaces read, the air builds, when the clouds
ask (`airRequests`, `encodeAtmosphere.ts`), the haze's light alone and the air's alone in two volumes
of the same cells (`hazeSeparate`, the march keeping `radianceMie` and `radianceRay` apart, the
ozone's absorption shared half and half), and the haze all around a capture's place (`capture360`: a
longitude and the sine of the latitude across, the distance down), read with `hazeOnly`, `airOnly`
and `captureHaze` (`separatedWgsl.ts`). The clouds' high-quality haze (`cloudHighQualityAerial`)
marches it for the pixel to the cloud's depth (`cloudHaze`, `cloudHazeWgsl.ts`).

**Clouds with no atmosphere.** The clouds need an atmosphere no more than the reference's do: a
clouds part is drawn in the view, in its shadow maps and in the sky light's capture whether or not the
scene has an air. With none they stand on the planet of their own
`planetRadiusKm` under the plane `y = 0`, over a stand-in air (`airlessAirOf`, `writeAirlessFrame`): a
white transmittance, no haze (the haze on the clouds and the sun's per-sample tint are off), the
frame's eye where it stands, written once an image whoever asks first. The air's block holds the
lights of the air as they are, the clouds' illuminance outside the air times a transmittance of one
(`packAtmosphere`, the lights of the air with no air: no disk, the light's own illuminance, its place
in the light buffer kept for the clouds' shade), where a clouds part is followed and asks for them
(`SceneLightStore.setAirlessSuns`; the block of a scene with no atmosphere and no clouds stays all
zero), and the distant sky light that lights the clouds is the sky light's own diffuse light of no
direction (the harmonics' first terms, `skyHarmonicsSimple` at the origin, `cloudDistantSky`), read
from group 2 of the trace (`CloudTraceKey.skyLight`). The clouds' own switch is `cloudsOn`: off, no
clouds part is followed (`skyAtQuality`, applied at each image from the session's live sky quality
settings). A reference quirk is not reproduced: with no atmosphere the reference puts the planet's
centre at the view's origin, which bends the ground bounce's normal (`groundContribution`, off by
default) toward the view ray; ours keeps the true normal.

**The capture's clouds and the sun's shadow.** The sky light's capture traces its clouds with the program
of its key (`captureCloudKey`): the sun's shadow in the opaque scene lights them where the capture asks
for the opaque scene's shadows (`skyLightShadowFromOpaque`) and the clouds read the shadow map
(`cloudSampleLightShadowMap`), through the shadow maps' channel of the sun the view uses; the program
is compiled when first asked and the capture waits for it (`cloudsCompiled`).

**The clouds' time.** The clouds drift by the world's time of the image, the clock the material
graphs read (`WebgpuRun.graphClocks.time`, taken once an image from the world's clock, the wall
clock in an engine with no world): a paused world holds the clouds still, and every reader of an
image — the view's trace, the shadow maps, the sky occlusion, the sky light's capture — reads the
one value. A held image is drawn again (`cloudsMoved`) when the world's clock moved since the last
image drawn while a wind drifts the clouds, while a storm flashes, and while a cut leaves the
rebuilding unfinished; not when the wall clock alone ran on.

**The cloud's shade on itself.** The trace program has two forms (`CloudTraceKey.volumeShadowMap`): the
default marches the shade toward each light (`cloudShadow`); with the material's `rayMarchVolumeShadow`
off it reads the lights' shadow maps in group 2 (`cloudMapShadow`, `cloudShadowDepth`), nothing marched.
The sky light's capture takes the same choice and reads the maps built this image.

**The density bound.** Every march (the view, the shadow ray, the ground's bounce, the shadow map) probes
a point first (`cloudProbeAt`: its altitude in the layer and the layout's four pattern reads, with the
layout's screen gradients, `CloudSite`), skips it where the conservative density is not above 0
(`cloudProbeDense`) and reads the rest of the material only after (`cloudPointOf`): an empty sample costs
the four reads. The lamps' shadow rays read the whole material (they have no bound to test).

**The empty-space table** (`modules/sky/clouds/emptySpace.ts`). Where `cloudEmptySpaceSkipping` is on and
the image is not a reflection (`CloudTraceKey.emptySpace`), a compute pass writes, before the view's
trace and from the very block the trace reads, a 32 × 32 table of `r32float` kilometres over the view: a
group of 64 threads to a texel, one to each of 64 slices of `cloudEmptySpaceSkippingDepthKm` along the ray
through the texel (an orthographic view's from the texel's own point, as the trace's rays), each asking
the material's empty-space output (`cloudMaterialEmptySpace`) at the centre of its froxel and, with
`cloudEmptySpaceSkippingCorners`, at its eight corners, keeping the greatest; a slice that answers above
0 stores its own distance moved by `cloudEmptySpaceSkippingSliceBias` slices, the others the whole depth,
and the texel holds the nearest. The trace (`traceExtraWgsl.ts`, group 2, binding 0) starts a ray at
`uint(start / step)` steps along, and steps over empty air one sample at a time, so that the table's
texels never show. The built-in material leaves the output unconnected, which says matter is there
everywhere: its table holds the bias alone. The table is the view's, made on the first ask and kept with
its images (`emptySpaceTableSlot`).

**Orthographic views.** Under an orthographic camera each pixel's ray leaves the pixel's own point on the
near plane and runs along the view's direction, the same for every pixel; its depth, the scene's depth
cut and the layer test are measured from that point. A pixel whose ray starts inside the layer's outer
sphere shows no cloud (the camera is in the sky), and the scene's depth cuts a ray only where the layer
ends before the far plane. The view is traced directly, a ray for each pixel, with no history and no
enlarging, and laid over the lit image as it is traced (the ways that enlarge a reduced image read the
eye's rays, which an orthographic view has none of). The air is drawn as well ([the air under an
orthographic camera](#atmosphere-and-sky-light)).

**Sizes and upsamplings.** The four sizes (a quarter traced, half rebuilt, then enlarged; half; a quarter
rebuilt at the full size; full) and the five ways to lay the image over the scene (bilinear, bilinear with
a jitter, nearest with a depth test, jittered with the depth test, bilateral) are the reference's, step
for step: the trace and rebuild factors, the order of the pixels traced over the images of a cycle (2×2: 0
2 3 1; 4×4: 0 8 2 10 12 4 14 6 3 11 1 9 15 7 13 5), where the fog is laid late (the quarter-to-half and
quarter-to-full sizes), which sizes force the nearest way, the jitter's four directions, the bilateral
choice among the two surfaces of four texels, and its fall back to a soft bilinear read. The scene's depth
is read at the last coordinate of the depth image the trace uses: the view's size less one over a texel of
that image in view pixels (the view's size for the quarter-to-full and full sizes and a direct trace, half
of it for the others).

**The cloud material.** The material's mask term adds to the coverage times (profile + noise); the
layout's placement offset does not move the mask (the placement is added back to the mask's coordinates)
while it moves the pattern, as the material the layout comes from is built; the wind carries the three
noise offsets by `wind · alpha · time / tile` on all three axes.

**Drawing.** The sky is premultiplied radiance over the HDR image where the colour pass left the
background, with no fog in its own draw: the fog pass lays the fog's height law over it like over any pixel
([Fog](fog.md#fog), the sky), so exposure, the curve and the temporal resolve treat it as any surface. The haze
(aerial perspective) is read by every surface, over the fog: `L' = L · T + S`, opaque and transparent alike — the
opaque surfaces by the fog pass from the haze volume as a 3D texture (`fogOpaque`, `hazeSampledWgsl`), the translucent
layers through the light buffer, where the volume lives behind the fog's block (`lighting/atmosphere/layout.ts`;
`fogged`, `fogOver`, `lighting/fogShader.ts`); the fog takes the sky's mean radiance on as its own
colour and scatters the sun's light on the ground ([Fog](fog.md#fog)). A scene without an atmosphere reads
none of it. The unlit view and the views that paint raw values show none. The sky's draw binds no fog: the
light shafts' occlusion mask is read by the fog pass (`DEFERRED_BINDINGS.fogLightShaft`).

**The air under an orthographic camera.** The sky, the haze on the surfaces and the haze on the clouds are
drawn under an orthographic camera as under a perspective one, from a ray that starts where the pixel's
does: the point of the near plane under the pixel, raised by half the view's height along the planet's up
(so that the bottom row of a view that stands on the ground starts from the eye's height, not from under
the ground), and runs along the view's direction, the same for every pixel (`airRay`, `airRayWgsl.ts`).
The raise is worked out once an image, on the CPU, from the view's matrices, and held in the frame
(`AirFrame.lift`, `writeAirFrame`), the programs adding it as it stands. The sky is read from the table
around the eye at the height each pixel starts at; the haze volume is built along those rays, and a
surface reads it at its distance along the view's direction from the near plane, which is the same for
every pixel of the surface's depth. The sky light's capture, taken from a place of its own, is a
perspective view whatever the camera is.

```js
world.scene.sky = { atmosphere: true, sun: true, clouds: true } // the sky, the haze and the clouds, whatever the camera
// The horizon is seen from the height of the camera's bottom row: raise the camera to look from higher.
camera.position.set(0, 10, 100)
```

**Sky light.** The `skyLight` part (a light that affects the world) gives the scene the sky it
captures into a cube (`modules/sky/skyLight`): the cube, filtered by roughness, and nine harmonics
summed from it (the real-time capture's from the filtered cube, a captured scene's and a specified
cubemap's from the captured cube's mips, before the filter), on the GPU, never read back. Every reader reads that one cube, through the light's
read (`modules/sky/skyLight/read.ts`), at the colour of the light times its intensity, black in a
view whose `skyLighting` override is off. The diffuse light of a surface is the harmonics along its
normal (`skyLightDiffuse`): where the bounce probes answer they carry the sky, occluded by the scene
([Light that bounces](light-that-bounces.md#light-that-bounces)); the share they leave is the sky light's own diffuse
light, the sky nothing hides. The volumetric fog scatters the harmonics' first three terms along the
way to the eye, times the part's `volumetricScatteringIntensity`. A specular read takes the cube
along the reflection vector at the mip its roughness asks (`skyLightReflection`); a bounce probe's
ray that leaves the scene reads it sharp (`skyLightRay`). Its lower half is the sky's own, or, where the part's
`lowerHemisphereIsSolidColor` is on (off by default), the part's `lowerHemisphereColor`, black by default, laid into the cube at the capture by the part's
`lowerHemisphereCoverage` (1 by default: the colour whole, less of it letting the sky and the clouds
below the horizon show through). Without an atmosphere the cube is black (clouds aside). A specified
cubemap is the part's own `cubemap` (six faces of linear texels as data, `SkyLightCubemap`, the form
of the fog's cubemap), the engine making the texture of it and keeping it while the data is the same
(`followSkyCubemaps`: half floats, the whole cube written times the scale that brings the brightest
texel of the cube and of the one it blends to to the half float's largest, 65504, where it passes it
— one scale for the pair (`cubemapPairFit`), so that the mix is of two lights in one unit —, and the
light given the inverse, `skyLightCubemapScales` and `SkyLightInputs.cubemapScale`: no texel is
clamped, on any device; the faces are written one after the other, over several images, no more than
about a million channels converted an image, from one buffer, and the cube is the light's once its
six faces are written, `SkyCubemaps.pending` holding the image drawn until then). It blends to a
second one by a fraction (the part's `cubemapBlend`, `SkyLightInputs.blend`): both are filtered, and
the light mixes the two cubes and their harmonics. The harmonics are seven vectors a cube. A mean
brightness of the cube (an eighth vector) is not kept: its one reader weighs the reflections of a
surface lit by baked light — a lightmap, or the volumetric lightmap read at the surface — by it,
under a sky light that is not movable, and the volumetric lightmap here lights the volumetric fog
alone, no surface (`lighting/fog/staticPass.ts`). The sky light's `cloudAmbientOcclusion…` fields do
not act on the cube, the harmonics or any surface's light: they dim the air's multiple scattering
(Shade the clouds cast on the air, above).

**The real-time capture.** The light is read from the first frame the cube has been drawn whole in (the frame
draws it in the command buffer that lights the image): until then a surface sees no sky light and the
bounce waits, never a cube that was made and not drawn into. The capture is made once a frame, from the main
view's air and clouds; a view drawn beside the main one, and the image drawn aside for a capture, read the
light and make none. The faces are written multiplied by the capture's pre-exposure (`cachedLightingPreExposure`,
[Pre-exposure](exposure-and-the-display-curve.md#exposure-and-the-display-curve)) and the light's colour holds its inverse. The sky of the capture is held, as the
sky of the view, to 32256 per channel once multiplied by it (half of what a 10-bit float holds, room for what
is added after it); the clouds and the lower hemisphere are not held by it. The sky is marched from the
light's height over the planet's ground, no lower than the eye of a view is held (5 m). A bright sun disk is
not in the capture (it is a light of its own). The cube's side is the part's `cubemapResolution` (made a
power of two), or the quality's `skyLightResolutionOverride` when that is 16 or more: the override is the
real-time capture's alone.

The sky pass. The surfaces of a sky material (the compiler's `sky` property) are drawn by a pass of their own, `encodeSkyPass`
(`frame/render/encodeSkyPass.ts`), into the lit image right after the opaque surfaces are lit and before the atmosphere, the fog and
the clouds are laid over it, as the sky pass of the base pass comes ahead of them: unlit, at an alpha of one (a cutout keeps its mask),
tested against the opaque depth and writing none. They are in no layer of the translucency: the plan marks them in the item's filter
word (`ITEM_FILTER.sky`) and the expansion keeps them out of every view but their own (`SKY_VIEW`, `blend/expand/expansionViews.ts`),
so the front pass, the hierarchical depth, the shadow page marking, the screen traces, the cards and the shadows never see them. They
take no fog of their own (`FLAG_FOG_FREE` on their row): the fog composition lays it once, the dome in it.

The sky meshes. Where the scene has a sky material drawn (`sceneHasSkyMaterial`, `frame/render/skyRoots.ts`: a root whose
surface has the compiler's `sky` property, not hidden by its host, or a sky surface of the plan that no node stands for, an actor of an
HLOD cell or of the world DAG), the faces of the real-time capture show the sky meshes in the place
of the atmosphere. Before the main view, each face is a light draw (`frame/render/encodeSkyMeshes.ts`, `encodeSkyMeshFace.ts`): the
blend pass's own plan (cut, cull, sort, expansion, runs) called for the 90 degree camera of the face at the light's place, drawing the sky
surfaces alone (the plan's sky view, the same runs as the sky pass; the face's cut is `Camera.showOnly` of the sky nodes while each sky
surface has one) into the face's colour and depth targets in one pass, with no lighting, shadow, fog, sky, cloud nor
effect (`ViewOverrides.skyMeshCapture`); the view of the face only holds its cut and its targets. A sky surface is opaque, its cutout
alone reading the base alpha. With `skyLightDepthBuffer` (on) the pass writes the depth of the meshes (`BlendModePipelines.skyFace`):
they cover each other by their distance, the depth is copied beside the image into the meshes' cube (`modules/sky/skyLight/skyMeshes.ts`,
`skyMeshDepthMain`), and the height fog is laid over each pixel at the distance of the mesh drawn there (`fogFaceProgram`'s `depth`,
`fogBeyondAlong`), an endless ray only where no mesh is; off, the meshes are painted in their sort order and the fog is laid along an
endless ray. The fog is laid once, by the capture, never by the faces' own surfaces (`FLAG_FOG_FREE` on the sky surfaces' rows). The
image is copied into the face multiplied by the pre-exposure (`skyMeshMain`), the clouds going over it as over the atmosphere. The
quality settings slice it as they slice the capture (`skyLightTimeSlicing`, `skyLightFacesPerFrame`); the first images draw all six
faces, and the atmosphere shows until the cube is whole. A face that draws nothing for `600` images in a row is given up
(`sky-meshes-failed`, said once) and the frame holds again; the faces are tried again when the plan's sky surfaces change.
The same fact orders the fog drawn in textures of its own (above): with a sky material the sky and the haze are drawn before the
fog's textures; without one the textures come first and the sky is drawn over the image whole.

**Reflections.** A reflection ray that leaves the scene reaches the sky along its direction
(`reflectionEnvironment`, `lighting/reflections/field.ts`): the sky light's cube, sharp for a ray, at the
roughness of the lobe for the field's read; a scene with an atmosphere and no sky light shows none, the
sky a ray reaches being the sky light's alone; a scene with neither keeps the flat background the
screen draws. Where the probes hold the sky, the field of a reflection takes the
environment for the share they do not answer alone, the sky never twice.

**Sky light, captured scene** (`modules/sky/skyLight/captureScene.ts`). A sky light whose
`realTimeCapture` is off and whose `sourceType` is `'capturedScene'` (the default) lights the scene
with the scene itself, drawn once into its cube from the light's position. Six cameras, one per face
of the cube, +x, -x, +y, -y, +z, -z, each square with a field of 90 degrees and its nearest distance
the light's `skyDistanceThreshold` (150000 cm, so nothing nearer than 1500 m is in the cube), draw
the scene aside (`Engine.captureHdrViews`, `frame/io/hdrCapture.ts`) at the cube's side
(`cubemapResolution`, made a power of two) times `skyLightCaptureSupersample` (1). The image of a
face is the lit linear radiance, before exposure, the effects and the tone curve; it is clamped to
the half float's range, the colour below the horizon is the light's `lowerHemisphereColor` by its
`lowerHemisphereCoverage` when `lowerHemisphereIsSolidColor`, and it is copied into the face
(`copySceneFaceMain`); then the mips, the nine harmonics and the filter by roughness are made
(`captureFilter.ts`), as for a specified cubemap. The harmonics are summed from the captured cube's mips,
before the filter (`capturedIrradianceMain`): a grid of 32 by 32 texels on each face, read bilinearly at the
mip of that side (the top one for a cube smaller than that), each texel weighted by the share of the sphere
it stands for, and a coefficient is 4π times the weighted sum of the radiance times the basis, over the sum
of the weights. The cube is written at a pre-exposure of 1. The mean of the sky radiance the light reports is
the harmonics' last vector, as for any source.

The faces are drawn by a view of their own with `ViewOverrides` (`frame/backend/state/viewOverrides.ts`):
no sky light, every surface of roughness 1, no particle, light shaft, light function, effect,
exposure, tone curve or temporal pass, the cut asked at `skyLightCaptureLodDistanceScale` (1, a
value of zero or less being 1), no reflection traced;
with `captureEmissiveOnly` the lights, the probes, the reflections and the occlusion are off and the
diffuse and specular colours are zero, so that only what the surfaces emit is in the cube. The main
view holds the neutral overrides: its programs read none of them, and the rewrite of the roughness
and the diffuse colour (`lighting/deferred/surfaceOverride.ts`) is a pass encoded for a capture view
only.

It is drawn between two frames, after the frame is submitted, never inside it; the cube read by the
lighting (`read()`) is the last one made, and stays until the next replaces it. A capture is asked
when the light is created, when it first captures a scene, when its cubemap or the angle of its
cubemap changes, when `realTimeCapture` is switched, when its cube is made again (a new
`cubemapResolution`), and by `recapture()`; not when its colour, intensity, lower hemisphere or
distance threshold changes, nor when it moves: those apply at the next capture. A static light is
not captured, and neither is a light with `affectsWorld` off.

```ts
const part = resolveSkyLight({
  realTimeCapture: false, // the scene is captured, not the sky
  sourceType: 'capturedScene',
  mobility: 'stationary', // a static light is not captured
  cubemapResolution: 128,
  skyDistanceThreshold: 150000, // centimetres: the near plane of the faces
  captureEmissiveOnly: false,
})
const capture = createSkyLightCapture(device, report)
const input = {
  part,
  width: skyLightCubeWidth(part, maxCubeSide),
  position: [0, 10, 0],
  frame,
  atmosphere: false,
  fogShown: false,
}
// Once a frame, after it is submitted:
if (capture.sceneDue(input)) await capture.captureScene(engine, input)
const sky = capture.read() // the cube, its mips and the harmonics; none before the first capture
// The world changed (a building came down): the sky is captured again at the next look.
capture.recapture()
```
