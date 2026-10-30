# Fog

The height fog part of the sky module is a term of the one lighting model, applied by every program that lights a surface:
the law is `packages/sdk-core/src/scene/core/fog.ts` and `fogHeight.ts`, its shader text
`lighting/fogShader.ts`, its options [SDK.md](../sdk/lights/height-fog-part.md#height-fog-part). A surface's radiance `L` reaches the
eye as `L · T + S`, before the exposure; `T` is the transmittance along the view ray, `S` the light
the medium scatters toward the eye. The linear fog is the ramp from `near` to `far`, `S = color ·
(1 − T)`. The height fog is the reference's:

- **Law.** The density at the height `y` is `baseDensity · 2^(−falloff · (y − baseHeight))`. A ray of
  length `d` that rises by `dy` from an eye at `yEye` gathers `X = baseDensity · 2^(−falloff · (yEye
− baseHeight)) · d · (1 − 2^(−F)) / F`, `F = falloff · dy` (`ln 2` where `F` is nil), and
  `T = max(2^(−X), 1 − maxOpacity)`. `X` is `ln 2` times the integral of the density along the ray,
  used as the exponent of 2: a uniform medium of `baseDensity` extinguishes at `(ln 2)² ·
baseDensity` per metre (`T = exp(−0.4805 · baseDensity · d)`). Steps, in the shader's order: no fog
  past `cutoffDistance`; the eye's height held to 655 m above `baseHeight`, the rise compensated;
  `startDistance` moves the ray's origin along it; the line integral is the mean density of what
  remains, shared with the sun's lobe. The mean density is written from the ray's lower end
  (the same value as from the eye) so a high eye over a steep falloff loses nothing to a product of a
  huge number and a tiny one.
- **Units, and the exact conversion.** The numbers are those of the reference, in scene metres.
  Its density and falloff are per 1000 centimetres: `baseDensity` is its density ÷ 10 per metre,
  `falloff` its falloff ÷ 10 per metre; its distances are centimetres, metres are ÷ 100. So
  the reference's `0.02`, `0.2`, `10 000` are `baseDensity` 0.002 (extinction 9.6e-4 per metre at the
  base height), `falloff` 0.02 (the density halves every 50 m) and a lobe start of 100 m.
- **Defaults**, the reference's, converted: `color` black; `baseDensity` 0.002; `falloff` 0.02;
  `baseHeight` 0; `maxOpacity` 1; `startDistance` 0; `cutoffDistance` 0 (none);
  `directional.exponent` 4, `.startDistance` 100, `.color` black; `skyContribution` white. A fog that
  declares nothing is that fog (`{}`), whose colour a scene with an atmosphere gives it.
- **Colour from the sky.** With an atmosphere, `S = (color + skyContribution · skyMean ·
heightFogContribution) · (1 − T)`, `skyMean` the sky's mean radiance at 6 km (the table the
  atmosphere builds each image, `lighting/atmosphere/captureWgsl.ts`) and `heightFogContribution`
  the atmosphere's (1 by default); the black default `color` leaves the sky alone. The sun's lobe
  adds `(directional.color · sunLuminance + heightFogContribution · E_ground) · max(0, ray · sun)^exponent
/ 4π · (1 − T_lobe)`: `sunLuminance` is the luminance of the sun's colour times its intensity (the
  weights of the sRGB primaries), `E_ground` the sun's illuminance after the air, `T_lobe` the
  transmittance of the same mean density over the length past `directional.startDistance` (none
  before it). So the sun's light is scattered by the default fog over an atmosphere, its declared
  colour black. The sun is the one the store holds, with an atmosphere or none, else the first
  directional light added (`scene/light/fogSun.ts`, written in the fog block by the store). With no
  atmosphere the colour is the declared one and the lobe the declared lobe.
- **The sky.** The sky's pixels are fogged as any (`fogBeyondAt`, `lighting/fogCompose.ts`, called by
  the fog pass (`lighting/fog/fogPass.ts`) over the sky drawn before it and over the background, with the pixel:
  it lays the light shafts' mask and the local fog volumes over the sky too; `fogBeyond`, the same without them, is what the sky light's
  capture reads): a ray that leaves the scene meets nothing in any distance, a ray of 10¹¹ m that
  gathers the whole height integral, without the haze — the sky is the air. Looking up, with `dirY`
  the ray's rise, `T = 2^(−X)` and `X = baseDensity · 2^(−falloff · (yEye − baseHeight)) / (falloff · dirY)`:
  about 1, but within a degree of the horizon. Level or down, the density below the eye grows
  without end and `T = 1 − maxOpacity`: the fog's colour alone, so the horizon is a line at
  elevation 0, and the ground that is not drawn, past the scene's own, has that colour. The sky's
  table below the horizon — the air before a ground that is not drawn, almost dark — shows only
  where the scene has no height fog. A distance fog leaves the sky as it is. With no atmosphere the
  fog pass fogs the pixels no surface drew (`fogsBackground` — true for a local fog volume and
  no fog too —, `heightFogMain` in `lighting/fog/fogPassWgsl.ts`) with the same law: the fog's inscattering plus the background's radiance
  ([The background](the-display-finishing.md#the-display-finishing)) through the transmittance `T` — the background's
  colour looking up, the fog's alone from the horizon down.
- **Old fields.** `{ color, density, heightFalloff?, baseHeight? }`, the extinction form — `T =
exp(−density · d)` where nothing falls off, the density divided by e every `1 / heightFalloff`
  metres up — is a spelling of this law, mapped exactly: `baseDensity = density / (ln 2)²`,
  `falloff = heightFalloff / ln 2`, the other fields at their defaults (`heightFogOf`). The GPU holds
  one law; no scene changes its image.
- **Where it is drawn.** Three switches of the height fog, on by default (`ResolvedHeightFog`,
  `scene/core/fogHeight.ts`): `inMainView`, the views the page draws; `inReflectionCaptures`, the six
  views of the scene the sky light captures from its own place (`ViewOverrides.reflectionCapture`,
  `skyLightCaptureOverrides`); `inSkyCapture`, the distant fog laid over the sky of the real-time
  capture (`SkyLightInputs.fogShown`, decided on the CPU). Each image writes whether its view shows the
  fog in lane `x` of the height-fog slot of the view block (`FOG_VIEW_SLOT.heightFog`, `fogHiddenIn`,
  `frame/render/fogView.ts`); where it does not, no volume is built for it (`volumeMedium`) and
  `heightFogAlong` answers `(0, 0, 0, 1)` — the surfaces, the translucent layers, the sky pixels
  (`fogBeyondAt`), the clouds and the reflections' rays are unfogged — while the atmosphere's haze, the
  local fog volumes and the linear fog are other components and keep their own. The capture's own pass
  (`fogBeyond`) reads no lane: `heightFogLaw`, the law alone. There is no holdout: the engine's images
  carry no alpha to hold out into.
- **The sky light on the fog.** `skyLightScattering { strength, roughness }` (0 and 0.15 by default)
  with the project switch `fogReadsSkyLight` (off by default): in a view with sky lighting and a ready
  cube (`skyLightFogOf`, `frame/render/skyLightFog.ts`) the programs that lay the fog read the sky
  light's filtered cube of the ready layer in the place of the fog's own cubemap (`FogVolumeState.skyRead`,
  `fogReadOf`: one binding, nothing added to a program), and `heightFogLaw` takes, with `s` the
  strength, `colour = mix(colour, skyLightColour · cube(sceneToCube(ray), mip), s)` and
  `lobe · (1 − s)`, the fog's own cubemap not read: the ray is the one the fog is integrated along, the
  mip is `roughnessMip(roughness, mips)` with the count of the cube's mips (the view block carries the
  strength, the roughness, the count and the light's colour, which `skyLightColor` gives with the
  capture's pre-exposure divided out). The capture's own fog pass reads none of it, the views drawn for a
  capture have no sky lighting (`ViewOverrides.skyLighting`), and the programs that bind no cubemap
  (the reflections' rays) answer no sky light: so the capture never reads what it writes. The
  volume's cells and the local fog volumes are not lit this way. A strength of 0 reads no state and no
  texel.
- **The fog in textures of its own.** Where the scene's fog asks for `screenSpaceScattering` (and the run's
  `fogSeparateComposition` is `auto`, or `on`) the image does not lay the fog at once (`planSeparateFog`,
  `frame/render/encodeFogSeparate.ts`). The fog pass's program writes, ahead of the sky, two textures of the
  image's size (`fogSeparateMain`, `lighting/fog/separateWgsl.ts`): the colour (`rgba16float`, with levels) holds the fog's
  light plus the share `pow(saturate(coverage · amountScale), amountPower)` of the lit image times the
  transmittance, its alpha the clouds' transmittance (1 until they are composed in); the side texture (`rg16float`) holds
  the width of the point spread `sqrt(0.5 / (2 a / 3s + 4 / (3 s³ b)))` of a medium of the fog's extinction over the
  pixel's depth (albedo 1, so a = 0; a pixel no surface drew is taken at an infinite depth) and the transmittance left
  once the scattered share is taken. The clouds' composition draws into the first level of the colour texture, with the
  blend it has over the lit image. The blur chain (`lighting/fog/separate.ts`) then builds the levels: the second level
  is the first run through a temporal filter (`lighting/fog/separateTemporal.ts`: the camera's motion from the nearest
  depth of a cross two pixels wide, the bicubic history held to the box of the pixel and its four neighbours, a share of
  the new image `fogScreenSpaceScatteringTemporalWeight` taken toward 0.2 by the motion, at least a share of the history's
  luma over its difference, 1/4 on a responsive pixel, all weighed by luma; the 2x2 average of its output is the level and
  the output is the history kept in the temporal pass's history format), or, with `fogScreenSpaceScatteringTemporal` off or
  the filter not ready, a 4x4 box down (four bilinear taps), and the other levels by the box too; every level filtered with the 5x5 Gaussian as nine bilinear taps (texels held to
  `fogScreenSpaceScatteringMaxLuminance`), then every filtered level but the last blended with the next coarser one by
  `blurControl`; the last level stays the box's. The upsample reads each pixel at the level
  `coverage · spreadScale · clamp(log2(width / 2), 1, last)` (trilinear), faded by `saturate(width)`, and lays it
  over the lit image: light added, image multiplied by the unblurred transmittance times the clouds'. A pixel of
  width 0 (no medium) takes the first level as it is, so the clouds composed there are laid. The half-resolution composition is not made. The fog's holdout does not apply; the
  haze of the air, laid on the surfaces after the fog, is laid before it here.
- **One law, written once.** The analytic fog and the volume's cells read the density of the medium
  through one function (`fogLayerDensity`, `fogDensityAt`, `lighting/fog/lawWgsl.ts`): a layer's
  `baseDensity · 2^(−falloff · (h − baseHeight))`. The analytic fog holds its exponent (to [−125, 126]
  where a ray starts at the eye, to at most 127 where it starts past a distance: `fogOriginTerms`,
  `lighting/fogShader.ts`); the cells read it unbounded. What a density becomes is each one's own, as
  the engines that fixed them have it: the analytic fog reads it as the exponent of two — `T = 2^(−X)`,
  `X` `ln 2` times the density's integral, so a uniform medium extinguishes at `(ln 2)² · density` per
  metre — the volume as an extinction of half the density, per metre. Half is `(ln 2)²` to within
  4.07 %: over any ray and any falloff the volume's optical depth is `0.5 / (ln 2)²` = 1.0407 times the
  analytic fog's, which a test holds them to by running the scatter, the integration and the analytic
  fog on the same ray (the cells' sum is that of each step's far end, off the closed form by at most
  half the share of the density a step's rise changes).
- **The matched glow follows the density.** Where the fog is made to match the volume
  (`fogMatchesVolume`), the glow is the fog's colour in the engines' unit — 10 000 times what it is
  otherwise — and follows the medium's density as the fog's own colour does: the light per centimetre
  is the glow's number times the density per centimetre, the halved density of the cell before the
  extinction scale (`fogMedium`, the frame's `matches` flag). Not matched, the glow is uniform.
- **Lights in the volume.** Each light scatters its colour times its `fogScattering` (lane 14 of
  its record, `1` by default; the volume and the clouds' lamps skip a light of `0`): the sun by the
  phase function and its shadow where its `shadowsFog` flag is set (a bit of the kind word, lane 12:
  the rank, under 4, plus 4 for a shadow, plus 8 for the fog's shadow, plus 16 for the transmission through the profile surfaces; a sun's by default); a local
  light by the inverse square of the distance a cell's radius longer, the window of its range, a
  rectangle's form factor, and one sample of its shadow map where `shadowsFog` is set and the setting
  `volumetricFogLocalShadows` is on (the default). The sun's shadow is also multiplied by the clouds'
  shadow on surfaces (`cloudShadowOnSurface`). The sky light adds the first three harmonics of its
  capture in the direction `−g` times the direction to the eye (`skyLightDiffuseSimple`, times the
  light's colour), times its volumetric scattering intensity (`skyLightScattering`, zero without a sky
  light). A light's light function multiplies its colour there ([Light functions](light-functions.md#light-functions)):
  the sun's from the atlas where `lightFunctionFog` is set and the atlas holds it, else from a texture drawn for the fog (`lighting/fog/sunFunction/`), a local light's where `lightFunctionFog` is set. The sky light's term of each
  sample is multiplied by the sky's visibility of that sample, the share a cone of 45 degrees
  straight up sees through the global distance field (`fogSkyVisibility`,
  `lighting/fog/skyVisibilityWgsl.ts`, read in the scatter itself), where the frame gives the field
  (the light is dynamic, casts shadows and a volumetric shadow, no screen probes light the fog, the
  view a perspective); a scatter with no field sees the whole sky. The static term is
  the baked light of the [volumetric lightmap](volumetric-lightmap.md#volumetric-lightmap), added to the light of each sample: a pass of its own
  before the scatter (`lighting/fog/staticWgsl.ts`; the scatter binds the most sampled textures a stage may and the lightmap is
  nine more) takes the samples the scatter takes — the cell's plan (`planWgsl.ts`: hidden, history, how many samples) and
  `fogSampleOffset` give the same points — and writes the mean of what they add, in a volume of three floats a cell that
  the scatter loads as a storage texture and adds to the mean of the lights. The scatter's light and this term are sums over
  the same samples, so their sum is the one the scatter would make sample by sample. A sample adds the lightmap's two
  bands dotted with the phase's zonal harmonic, over π, never negative, times the fog's
  `volumetric.staticLightingScatteringIntensity` (`FogStaticLight.intensity`: the fog's value while the image's lighting and the
  `volumetricLightmap` setting are on and the scene has a lightmap, else 0); and, where the sky light is stationary and
  casts shadows and the lightmap holds a bent normal (`skyShadowing`), the sky light's term times the bent normal's length
  in place of the global field's visibility. A static sky light lights the fog by none of its own harmonics (the lightmap holds
  its light), nor a view whose sky lighting is off, unless the fog's own colours stand in (`useFogColors`). The pre-exposure is applied: each cell's light is written multiplied by the
  image's pre-exposure (`frame.exposure.x`), the history's brought to it by the ratio of the two
  (`frame.exposure.y`), the extinction left as it is, and a surface reads the light divided by it
  again (`FOG_VIEW_SLOT.exposure`, `fogVolumeLookup`) — [Exposure](exposure-and-the-display-curve.md#exposure-and-the-display-curve).
  The clouds' lamps read a light as the
  fog does (`volumeLamp`, `lighting/direct/lampSeenWgsl.ts`): a lamp by `lampSeen` at `LAMP_BIAS`, a
  rectangle by its form factor, each times its `fogScattering`.
- **Objects of the volume material domain.** A mesh with a material of the volume domain
  (`material.volume`) draws no surface and a declared object (`addFogVolume`) none either: each is a
  box, or a sphere, voxelised into the medium before the light is scattered (`lighting/fog/voxel*.ts`).
  The record of each object that reaches the volume — its sphere closer to the eye than the fog's
  distance plus its radius — is written relative to the eye (`writeVoxelObjects`). A first pass, a
  thread an object (`prepareMain`), takes its sphere to view space, the slices of its nearest and
  farthest depth (`trunc(log2(depth · B + O) · S)`, the first held at 0, the last at the grid's) and
  the view-space rectangle of its box's corners. The second pass, a thread a cell (`voxelizeMain`),
  is the rasterisation of each object's camera-facing quad on each slice, seen from the cell: the
  quad lies at the slice's depth — the slice plus the frame's first depth offset —, over the
  object's rectangle (a box) or the square around the circle the sphere cuts the slice at (a sphere,
  radius `√(r² − Δ²)`, `Δ` the slice's distance from the sphere's centre in depth), shifted across
  by the frame's first offsets over the grid (`offset / cells` in device units, the quad's own
  shift); it covers the cell whose centre lies in its projection, left and top edges in, right and
  bottom out. A covered cell reads the object's material at its centre's place on the slice — the
  ray through it with the matrix the depth was drawn with — and counts it where that place lies in
  the object's sphere or box, by `fade³` with `fade = 1 − saturate((depth / distance − 0.6) / 0.4)`.
  What it adds — `albedo · extinction` of scattering, `extinction`, emissive light — goes in two
  volumes (scattering with extinction, emissive) that the scatter adds to the cell's medium
  (`fogMedium`): the object's scattering to the particles', its extinction to the extinction, its
  emissive light to the glow. Passes of `volumetricFogVoxelizationSlicesPerPass` slices (8) divide an
  object's slices; `volumetricFogVoxelizationShowOnlyPass` keeps one of them. The glow switch
  `volumetricFogGlow` gates the emissive light of the objects as it gates the fog's. In the
  `lighting` view the objects scatter with that view's diffuse colour (0.3) in place of their albedo,
  as every surface does. Authored
  numbers are per metre and the cells are metres: the scale of the units is 1. The sum over objects
  is made in single precision, once, where a blend unit adds half floats object by object.
- **Local fog volumes** (`SceneLocalFogVolume`, `sdk-core/src/scene/localFog/`, [SDK.md](../sdk/lights/height-fog-part.md#local-fog-volumes)).
  A volume is a unit sphere in its own space (`p` relative to its centre over its radius, 5 m times its
  matrix's largest column). Radially its density is `radial · 0.75 · (1 − d²)`, so a ray through the
  centre takes `radial`; along its up `h` it is `height · e^(−falloff/100 · (h − offset))`. A ray from
  `start` along the unit `dir` for `run` crosses `radialDepth = radial · (∫(1 − d²) dt) · 3/4` (the sphere's
  integral in closed form) and `heightDepth = height / (falloff · dir.up) · (e^(−f₀) − e^(−(f₀ + dir.up · run ·
falloff)))`, `f₀ = max(−80, (start.up − offset) · falloff)`, `dir.up` held to 1e-4 from 0. `Tr = e^(−radialDepth)`,
  `Th = e^(−heightDepth)`, `T = 1 − (1 − Tr)(1 − Th)`, and the volume's transmittance is `T^radius`
  (the optical depth carried to metres): its coverage is `1 − T^radius`. The ray is cut — from the
  sphere's near side or the larger of the volume's and the view's start distance, to the sphere's far
  side or the point — and, where the fog's volume covers the near air (`localFogVolumeInVolume`, the volume
  built this image), starts past the volume's far end along the ray. Its light is `(sun · phase(−g,
dir · toSun) + skyLight(−g · dir)) · albedo + emissive`, times the coverage: the sun is the forward
  directional light's colour times its illuminance, through the air toward it at the ground where it is
  the air's, and the sky light's first three harmonics are read as three rows of the light buffer that a
  one-thread pass writes each image (`localSkyWgsl.ts`: the harmonic's value is affine in the direction).
  In the analytic law no shadow darkens a local fog volume, neither the sun's nor the sky light's visibility
  nor the clouds'; the cells of the fog's volume light it as they light the rest of the medium, shadows included.
  The units are metres and per metre throughout (the reference's are centimetres and per centimetre); the
  height axis is the matrix's second column, the world's up being +y.
- **Where it lies in the fog.** `localFogOver` (`lighting/fog/localWgsl.ts`) gives the volumes' light and
  transmittance over a point, and `fogLaid`, `fogBeyondWith` (`lighting/fogCompose.ts`) put it in its place:
  every surface the lit passes light, the clouds' layers, the sky's pixels and a pixel the lighting
  paints as background — a translucent surface only where `localFogVolumeOnTranslucent` says so. A scene
  with a volume and no fog still draws it; the sky light's capture does not read them. Voxelised into the
  fog's volume (`localFogVolumeInVolume`, the default), the volumes lie over the height fog, the haze of
  the air behind both, and the fog's volume nearest of all (`over = stack(local, heightFog)`, the haze, then
  `stack(volume, over)`), the analytic law drawing only what lies before the volume's cells. Kept out of it,
  they are not in its cells and lie over the finished fog, the volume's light too, drawn whole
  (`stack(local, stack(volume, over))`), as a volume laid after the fog pass is.
- **In the fog's volume.** A cell adds `ext = −ln(Ta + Tb − Ta·Tb)` with `Ta = e^(−height · e^(−falloff/100 · (h −
offset)))`, `Tb = e^(−radial · fade^0.82)`, `fade = 1 − d`, nothing outside the sphere (the optical depth being
  linear in extinction, the combined transmittance becomes one extinction), held to
  `localFogVolumeMaxVolumeDensity` (1 per metre: 0.01 per centimetre), times the share of the cell's depth
  past the volume's start distance where it cuts the cell; the extinction adds to the cell's, `ext ·
albedo` to its scattering, `ext · emissive` to its glow (the glow's switch `volumetricFogGlow`); the
  lights scatter by the cell's own lighting, so the sun and the sky light that light the volume light these
  too. Nothing for a cell whose back is before the view's start distance. The cell's point, and the points of
  its front and back, are found along the one ray of its pixel (`fogCellRay`, `lighting/fog/gridWgsl.ts`).
- **The block.** The view's volumes are planned on the CPU each image (`lighting/fog/localPlan.ts`): the
  volumes with at least one extinction, sorted by priority, then distance (the farther first), then
  the order of adding, the most `localFogVolumeMaxCount` kept (the nearest and highest), none dropped for lying
  outside the view, written relative to the eye — a centre and a radius, the height axis, the numbers of the
  law, the albedo and phase, the emissive light — into the light buffer's `localFog` block
  (`lighting/fog/localLayout.ts`): 1 292 `vec4`, 20 672 bytes, the header (the count, the switches, the density
  cap, the start distance), the sun's light and direction, the rows of the view-projection the depth was drawn
  with for a point relative to the eye, the view's size and near distance, its tiling, the sky light's three
  rows, and room for 256 volumes of five `vec4` each (`frame/render/localFogView.ts`). It is written once it
  differs from what the buffer holds. A volume's law turns about its up unchanged, so no more of its rotation
  is kept. A scene with none writes nothing and costs the fog's programs a count read. The block is data of the
  light buffer's layout, in every session; the project switch `localFogVolumeSupport` off leaves it unwritten.
- **The tiles.** The view is cut into square tiles of `localFogVolumeTileSize` pixels, and before the fog is laid,
  one compute pass of two dispatches (`lighting/fog/localCull.ts`, `localCullWgsl.ts`) writes into a buffer made for
  the tile grid (`frame/render/localFogGpu.ts`, a read-only storage buffer of words, bound by every program that
  walks it as `localFogTiles`) the list of the volumes that can show over each tile: a count, then the volumes'
  numbers four to a word, in the order they are drawn. The first dispatch, only with `localFogVolumeUsesDepthPyramid`
  and once the image has built its depth pyramid, is a thread a volume: it finds those the pyramid hides — the
  sphere's box is taken to the screen, the furthest depth under its rectangle is read at the level where four texels
  cover it (the same read as the fog's volume's furthest depth), and the volume is hidden where even the box's nearest
  corner lies behind it; a box that reaches the eye's plane is never hidden. The second is a thread a tile: it keeps
  the volumes whose sphere is not wholly outside one of the four planes through the eye and the tile's edges (the
  planes' lengths divided out), nor wholly before the near distance, nor hidden. A pixel — the opaque surfaces, the
  sky, the translucent layers, the clouds — finds its tile by the pixel it is seen in, as the engines that fixed
  this do; the cells of the fog's volume have none and find it by the screen place of their centre. `localFogOver`
  and `localFogMedium` walk the list; a tile of count 0 returns before a volume is read; where the view is not
  tiled (the pass compiling, a grid too large for a binding, a program that binds no lists) they walk every volume
  of the view, with the same image. A header that says no volume is drawn is the whole answer: no stale list or
  volume is ever read. The buffer is made for the grid, once a volume is drawn, kept while it holds the grid and is
  not more than twice what it needs, and let go with the last volume; it counts in the bytes of the view's
  targets (`viewTargetBytes`, `metrics.views`). The tile side asked for is never raised: a grid whose lists
  would not fit a storage buffer of the device (the smaller of its buffer and binding limits) is left untiled,
  said once (`fog-local-tiles-too-large`).
- **In the frame.** Three steps, in the order the frame forces. `prepareLocalFog` (`frame/render/encodeLocalFog.ts`)
  is first, in the lighting's setup after the lights are pushed and before the transparents' groups are bound: it
  reads the settings once, writes the block, and makes or lets go the lists' buffer, which those groups name — a
  buffer made after they were bound would leave them on a destroyed one. `encodeLocalFog` follows the depth
  pyramid, complete with the image's transparents, and precedes the fog's volume that reads the lists.
  `encodeLocalFogSky` follows the sky light's capture, the one pass whose input is that capture's harmonics and
  the view's cross-fade between two sets (read-time values of the view, changing without a capture): it
  writes the three rows each image a volume is drawn, and is not folded into the capture's projection. The
  passes are made once for a device; a refusal to compile one is said (`fog-local-cull-failed`,
  `fog-local-sky-failed`) to the diagnostics of the runtime that last asked, and the volumes are then drawn
  untiled, or without the sky light's term.
- **The project switch.** `localFogVolumeSupport` (project setting, on by default) is read once, when the session opens
  (`WebgpuPagesSetup.localFog`). Off, every program that lays the fog — the opaque and bounce resolves, the blend and
  its transmissive stages, the sky and the clouds, the clouds' trace of the sky light's capture, the fog volume's
  scatter — is made without the local fog volumes' text (`fogComposeWgsl(false)`, `fogGridWgsl(false)`, the air's
  shape `AirShape.localFog`, which the capture also follows where the scene has no atmosphere), the culling and
  sky-term passes are never made, and the lists' buffer never exists. The programs that draw the sky light's cube
  faces and the reflections' are made without them whatever the switch says.
- **What differs from the engines that fixed this, and why.** The lists are a storage buffer, not a texture array:
  the blend's fragment stage holds its 16 sampled textures already, and the lists are
  its eighth and last of the 8 storage buffers (`gpu/core/stageLimits.test.ts` counts them: the next binding there
  must free one); the cells find their tile by projecting their centre, as theirs do; the tiles are
  not drawn one by one with an indirect draw, since the volumes are laid in the lighting, not splatted by a raster
  pass — a tile with no volume is skipped by its count; the planes the sphere is tested against are divided by their
  length (the engines that fixed this compare lerped planes undivided); the pyramid's verdict on a volume is
  found once for all the tiles, not by each tile's thread; the culling runs in the frame's stream and has no async
  switch, and no debug view of the counts is offered. The instance data is 32-bit floats, not packed in half and
  11-bit floats and bytes (the packing's error is at most the 11-bit float's 1.6 % on an extinction and a byte on
  the albedo and distribution; the floats hold what was declared). The start distance's depth-bound optimisation
  (the distance before which the fog's pass skips a pixel) is not made. The clouds find their tile with the
  de-jittered texel while the culling uses the jittered matrix: at most a pixel's seam on a tile's edge under
  the temporal resolve, as theirs.
- **Block.** Six `vec4` of the light buffer, behind the irradiance (`FOG_SLOT`): colour and mode, the
  law, the range, the lobe, the sky's factor, the sun (direction toward it and luminance); the local fog
  volumes' block follows it in the same buffer (above, `LIGHT_BUFFER_AT.localFog`).
