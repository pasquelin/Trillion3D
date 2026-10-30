# Fog

Height fog of sky module is a term of the one lighting model, applied by every program lighting a
surface: law `packages/sdk-core/src/scene/core/fog.ts` and `fogHeight.ts`, shader text
`lighting/fogShader.ts`, options [SDK.md](../sdk/lights/height-fog-part.md#height-fog-part). Surface
radiance `L` reaches eye as `L · T + S` before exposure; `T` = transmittance along view ray, `S` =
light scattered toward eye. Linear fog: ramp `near` to `far`, `S = color · (1 − T)`. Height fog
is reference's:

- **Law.** Density at height `y`: `baseDensity · 2^(−falloff · (y − baseHeight))`. Ray of length `d`
  rising `dy` from eye at `yEye` gathers `X = baseDensity · 2^(−falloff · (yEye − baseHeight)) · d ·
  (1 − 2^(−F)) / F`, `F = falloff · dy` (`ln 2` where `F` nil); `T = max(2^(−X), 1 − maxOpacity)`.
  `X` = `ln 2` times the density's integral along the ray, used as exponent of 2. Uniform medium
  extinguishes `(ln 2)² · baseDensity` per metre (`T = exp(−0.4805 · baseDensity · d)`). Shader
  order: no fog past
  `cutoffDistance`; eye height held to 655 m above `baseHeight`; `startDistance` moves ray origin
  along it; line integral = mean density of remainder, shared with sun lobe.
- **Units.** Reference density and falloff are per 1000 cm: `baseDensity` = its density ÷ 10 per
  metre, `falloff` = its falloff ÷ 10 per metre; distances: its cm ÷ 100. Its `0.02`, `0.2`, `10 000`
  = `baseDensity` 0.002, `falloff` 0.02 (density halves every 50 m), lobe start 100 m.
- **Defaults** (reference, converted): `color` black; `baseDensity` 0.002; `falloff` 0.02;
  `baseHeight` 0; `maxOpacity` 1; `startDistance` 0; `cutoffDistance` 0 (none);
  `directional.exponent` 4, `.startDistance` 100, `.color` black; `skyContribution` white. `{}` is
  that fog.
- **Colour from sky.** With atmosphere: `S = (color + skyContribution · skyMean ·
  heightFogContribution) · (1 − T)`; `skyMean` = sky mean radiance at 6 km (table atmosphere builds
  each image, `lighting/atmosphere/captureWgsl.ts`), `heightFogContribution` = atmosphere's (1
  default). Sun lobe adds
  `(directional.color · sunLuminance + heightFogContribution · E_ground) · max(0, ray · sun)^exponent / 4π · (1 − T_lobe)`:
  `sunLuminance` = luminance of sun colour × intensity, `E_ground` = sun illuminance after air,
  `T_lobe` = transmittance of same mean density over length past `directional.startDistance`. Sun =
  the one the store holds, with atmosphere or none, else first directional light added
  (`scene/light/fogSun.ts`). No atmosphere: declared colour and lobe.
- **Sky.** Sky pixels fogged as any (`fogBeyondAt`, `lighting/fogCompose.ts`, called by fog pass
  `lighting/fog/fogPass.ts`; lays light-shaft mask and local fog volumes too; `fogBeyond`, same
  without them, is what sky light capture reads). Ray leaving scene gathers whole height integral.
  - Looking up (`dirY` = ray rise): `T = 2^(−X)`, `X = baseDensity · 2^(−falloff · (yEye −
    baseHeight)) / (falloff · dirY)`.
  - Level or down: `T = 1 − maxOpacity`, fog colour alone.
  - Linear fog leaves sky as is.
  - No atmosphere: fog pass fogs pixels no surface drew (`fogsBackground`; `heightFogMain` in
    `lighting/fog/fogPassWgsl.ts`) with same law: fog inscattering + background radiance
    ([The background](the-display-finishing.md#the-display-finishing)) through `T`.
- **Old fields.** `{ color, density, heightFalloff?, baseHeight? }` (`T = exp(−density · d)`) map
  to the new ones (density divided by e every `1 / heightFalloff` metres up):
  `baseDensity = density / (ln 2)²`, `falloff = heightFalloff / ln 2`, other fields default
  (`heightFogOf`).
- **Where drawn.** Three height-fog switches, on default (`ResolvedHeightFog`,
  `scene/core/fogHeight.ts`): `inMainView`; `inReflectionCaptures` (`ViewOverrides.reflectionCapture`,
  `skyLightCaptureOverrides`); `inSkyCapture` (`SkyLightInputs.fogShown`). Each image writes whether
  view shows fog in lane `x` of view-block height-fog slot (`FOG_VIEW_SLOT.heightFog`, `fogHiddenIn`,
  `frame/render/fogView.ts`). If not: no volume (`volumeMedium`), `heightFogAlong` answers
  `(0, 0, 0, 1)`: surfaces, translucent layers, sky pixels, clouds, reflection rays unfogged;
  haze, local fog volumes, linear fog keep own.
- **Sky light on fog.** `skyLightScattering { strength, roughness }` (0, 0.15 default) with project
  switch `fogReadsSkyLight` (off default). In a view with sky lighting and ready cube
  (`skyLightFogOf`, `frame/render/skyLightFog.ts`), fog-laying programs read sky light's filtered cube
  instead of fog's own cubemap (`FogVolumeState.skyRead`, `fogReadOf`); `heightFogLaw` with `s` =
  strength: `colour = mix(colour, skyLightColour · cube(sceneToCube(ray), mip), s)` and `lobe ·
  (1 − s)`; mip = `roughnessMip(roughness, mips)`; light colour = `skyLightColor` (capture's
  pre-exposure divided out). Capture's fog pass reads none, the views drawn for a capture have no
  sky lighting (`ViewOverrides.skyLighting`), reflection rays get none; volume cells and local fog
  volumes not lit this way.
- **Fog in own textures.** If scene fog asks `screenSpaceScattering` (and run's
  `fogSeparateComposition` is `auto` or `on`) (`planSeparateFog`,
  `frame/render/encodeFogSeparate.ts`), fog pass writes two image-size textures before sky
  (`fogSeparateMain`, `lighting/fog/separateWgsl.ts`):
  - colour (`rgba16float`, with levels): fog light + share
    `pow(saturate(coverage · amountScale), amountPower)` of lit image × transmittance; alpha = clouds'
    transmittance (1 until composed in);
  - side (`rg16float`): point-spread width `sqrt(0.5 / (2 a / 3s + 4 / (3 s³ b)))` and transmittance
    left after scattered share.

  Clouds' composition draws into colour's first level; blur chain `lighting/fog/separate.ts`.
  - Second level = first through temporal filter (`lighting/fog/separateTemporal.ts`, share
    `fogScreenSpaceScatteringTemporalWeight`); `fogScreenSpaceScatteringTemporal` off: 4x4 box.
  - Levels filtered with 5x5 Gaussian (texels held to `fogScreenSpaceScatteringMaxLuminance`), blended
    with next coarser by `blurControl`.
  - Upsample reads each pixel at level `coverage · spreadScale · clamp(log2(width / 2), 1, last)`
    (trilinear), faded by `saturate(width)`, laid over lit image: light added, image × unblurred
    transmittance × clouds'. Width 0 takes first level as is.
  - No half-resolution composition or fog holdout; air haze is laid before fog.
- **One law, written once.** Analytic fog and volume cells read density through one function
  (`fogLayerDensity`, `fogDensityAt`, `lighting/fog/lawWgsl.ts`). Analytic fog holds exponent (to
  [−125, 126] at eye, at most 127 past a start distance: `fogOriginTerms`); cells read it unbounded.
  Analytic extinguishes `(ln 2)² · density` per metre; volume extinction = half density per metre
  (`(ln 2)²` within 4.07 %): volume optical depth = `0.5 / (ln 2)²` = 1.0407 × analytic's.
- **Matched glow.** Where fog matches volume (`fogMatchesVolume`), glow = fog colour in engines' unit
  (10 000 × otherwise), × medium density per cm (`fogMedium`, frame's `matches` flag); else uniform.
- **Lights in volume.** Each light scatters colour × `fogScattering` (lane 14 of its record, `1`
  default; volume and clouds' lamps skip `0`).
  - Sun: phase function and its shadow where `shadowsFog` flag set (kind-word bit, lane 12: rank
    under 4, +4 shadow, +8 fog shadow, +16 transmission through profile surfaces; sun's default);
    shadow also × clouds' shadow on surfaces (`cloudShadowOnSurface`).
  - Local light: inverse square of distance a cell radius longer, range window, rectangle form
    factor, one shadow-map sample where `shadowsFog` set and `volumetricFogLocalShadows` on (default).
  - Sky light adds first three harmonics of its capture in direction `−g` × direction to eye
    (`skyLightDiffuseSimple`, × light colour), × `skyLightScattering` (zero without sky light).
  - Light function multiplies colour ([Light functions](light-functions.md#light-functions)): sun's
    from atlas where `lightFunctionFog` set and atlas holds it, else from texture drawn for fog
    (`lighting/fog/sunFunction/`); local light's where `lightFunctionFog` set.
  - Sky light term per sample × sky visibility: share a 45-degree straight-up cone sees through
    global distance field (`fogSkyVisibility`, `lighting/fog/skyVisibilityWgsl.ts`) where frame gives
    field (light dynamic, casts shadows and volumetric shadow, no screen probes light fog,
    perspective view); else whole sky.
  - Static term = baked light of [volumetric lightmap](volumetric-lightmap.md#volumetric-lightmap),
    added to each sample's light by own pass before scatter (`lighting/fog/staticWgsl.ts`,
    `planWgsl.ts`; `fogSampleOffset` gives the same points). A sample adds lightmap's two bands ·
    phase zonal harmonic, over π, never
    negative, × `volumetric.staticLightingScatteringIntensity` (`FogStaticLight.intensity`: fog's
    value while image lighting and `volumetricLightmap` on and scene has lightmap, else 0); where sky
    light stationary, casts shadows, and lightmap holds bent normal (`skyShadowing`), sky light term ×
    bent normal length instead of field visibility. Static sky light lights fog by none of own
    harmonics, nor does view with sky lighting off, unless fog's own colours stand in
    (`useFogColors`).
  - Pre-exposure: cell light written × `frame.exposure.x`, history rescaled by `frame.exposure.y`,
    surface reads light ÷ it (`FOG_VIEW_SLOT.exposure`, `fogVolumeLookup`);
    [Exposure](exposure-and-the-display-curve.md#exposure-and-the-display-curve).
  - Clouds' lamps read light as fog does (`volumeLamp`, `lighting/direct/lampSeenWgsl.ts`,
    `lampSeen` at `LAMP_BIAS`), × `fogScattering`.
- **Volume material domain objects.** Mesh with volume-domain material (`material.volume`) or
  declared object (`addFogVolume`) draws no surface: box or sphere voxelised into medium before light
  scatter (`lighting/fog/voxel*.ts`; `writeVoxelObjects`):
  `prepareMain` (thread per object: sphere to view space, slices of its
  nearest and farthest depth `trunc(log2(depth · B + O) · S)`, rectangle of its box's corners), then
  `voxelizeMain` (thread per cell: rasterises each object's camera-facing quad per slice; a sphere's
  quad covers the circle of radius `√(r² − Δ²)`, `Δ` the slice's depth distance from the centre,
  shifted by the frame's first offsets, `offset / cells` in device units). Covered cell reads object
  material at cell centre, counts it
  where inside object sphere/box, by `fade³`, `fade = 1 − saturate((depth / distance − 0.6) / 0.4)`.
  Scatter adds it to cell medium (`fogMedium`): object scattering (`albedo · extinction`) →
  particles', `extinction` → extinction, emissive → glow.
  - `volumetricFogVoxelizationSlicesPerPass` (8) slices per pass; `volumetricFogVoxelizationShowOnlyPass`
    keeps one. `volumetricFogGlow` gates objects' emissive. In `lighting` view objects scatter with
    that view's diffuse colour (0.3) instead of albedo. Unit scale 1 (per metre, metres).
- **Local fog volumes** (`SceneLocalFogVolume`, `sdk-core/src/scene/localFog/`,
  [SDK.md](../sdk/lights/height-fog-part.md#local-fog-volumes)). Unit sphere in own space (`p`
  relative to centre over radius = 5 m × matrix's largest column). Radial density
  `radial · 0.75 · (1 − d²)` (a ray through the centre takes `radial`); along its up `h`:
  `height · e^(−falloff/100 · (h − offset))`. Ray from
  `start` along unit `dir` for `run` crosses `radialDepth = radial · (∫(1 − d²) dt) · 3/4` and
  `heightDepth = height / (falloff · dir.up) · (e^(−f₀) − e^(−(f₀ + dir.up · run · falloff)))`,
  `f₀ = max(−80, (start.up − offset) · falloff)`, `dir.up` held to 1e-4 from 0. `Tr = e^(−radialDepth)`,
  `Th = e^(−heightDepth)`, `T = 1 − (1 − Tr)(1 − Th)`; volume transmittance `T^radius`, coverage
  `1 − T^radius`.
  - Ray cut from sphere near side or larger of volume's and view's start distance, to sphere far side
    or the point; where fog volume covers near air (`localFogVolumeInVolume`), starts past volume's
    far end.
  - Light: `(sun · phase(−g, dir · toSun) + skyLight(−g · dir)) · albedo + emissive`, × coverage. Sun =
    forward directional light colour × illuminance, through air toward it at ground; sky light =
    three harmonics rows written each image (`localSkyWgsl.ts`).
  - Analytic law: no shadow darkens a local fog volume; fog-volume cells include shadows.
  - Units metres, per metre; height axis = matrix second column, world up +y.
- **Where it lies in fog.** `localFogOver` (`lighting/fog/localWgsl.ts`) gives volumes' light and
  transmittance over a point; `fogLaid`, `fogBeyondWith` (`lighting/fogCompose.ts`) place it: every
  surface lit passes light (`localFogOver` and `localFogMedium` walk the list), clouds' layers, sky
  pixels, pixel lighting paints as background;
  translucent surface only where `localFogVolumeOnTranslucent` says. Scene with volume and no fog
  still draws it; sky light capture does not read them.
  - Voxelised into fog volume (`localFogVolumeInVolume`, default): `over = stack(local, heightFog)`,
    haze, then `stack(volume, over)`; analytic law draws only what lies before volume cells.
  - Kept out: not in its cells, drawn whole over finished fog (`stack(local, stack(volume, over))`).
- **In fog volume.** Cell adds `ext = −ln(Ta + Tb − Ta·Tb)`, `Ta = e^(−height ·
  e^(−falloff/100 · (h − offset)))`, `Tb = e^(−radial · fade^0.82)`, `fade = 1 − d`, nothing outside
  sphere, held to `localFogVolumeMaxVolumeDensity` (1 per metre), × share of cell depth past volume
  start distance where it cuts cell. Extinction adds to cell's, `ext · albedo` to scattering,
  `ext · emissive` to glow (switch `volumetricFogGlow`); lights scatter by cell's own lighting.
  Nothing for cell whose back is before view start distance (`fogCellRay`, `lighting/fog/gridWgsl.ts`).
- **Block.** View's volumes planned on CPU each image (`lighting/fog/localPlan.ts`): volumes with at
  least one extinction, sorted by priority, then distance (farther first), then order added, most
  `localFogVolumeMaxCount` kept (nearest and highest), written eye-relative (centre, radius, height
  axis, law numbers, albedo and phase, emissive) into light buffer `localFog` block
  (`lighting/fog/localLayout.ts`): 1 292 `vec4`, 20 672 bytes: header (count, switches, density cap,
  start distance), sun light and direction, view-projection rows, view size and near distance,
  tiling, sky light's three rows, room for 256 volumes of five `vec4` each
  (`frame/render/localFogView.ts`). Unwritten with none or `localFogVolumeSupport` off.
- **Tiles.** View cut into square tiles of `localFogVolumeTileSize` pixels; before fog is laid, one
  compute pass of two dispatches (`lighting/fog/localCull.ts`, `localCullWgsl.ts`) writes per-tile
  list of volumes that can show (read-only storage buffer of words, `localFogTiles`,
  `frame/render/localFogGpu.ts`): a count, then volume numbers four per word, in drawing order.
  - First dispatch, only with `localFogVolumeUsesDepthPyramid` and built depth pyramid, thread per
    volume: finds volumes the pyramid hides.
  - Second, thread per tile: keeps volumes not wholly outside one of four tile-edge planes, nor
    before near distance, nor hidden.

  Where view is not tiled (pass compiling, grid too large for a binding, program binding no lists)
  programs walk every volume. Buffer made once a volume is drawn, kept while it holds grid and is at
  most twice need, released with last volume; counted in `viewTargetBytes` (`metrics.views`). Grid
  whose lists exceed device storage buffer is left untiled, said once (`fog-local-tiles-too-large`).
- **In the frame.** Three steps, forced order:
  1. `prepareLocalFog` (`frame/render/encodeLocalFog.ts`): in lighting setup after lights pushed,
     before transparents' groups bound; reads settings, writes block, makes or releases lists' buffer.
  2. `encodeLocalFog` follows depth pyramid, complete with image's transparents; precedes fog volume.
  3. `encodeLocalFogSky` follows sky light capture: writes three rows each image a volume is drawn.

  Refused compile is said (`fog-local-cull-failed`, `fog-local-sky-failed`): volumes untiled, or
  without sky light term.
- **Project switch.** `localFogVolumeSupport` (on default) read once, at session open
  (`WebgpuPagesSetup.localFog`). Off: fog-laying programs made without local fog volume text
  (`fogComposeWgsl(false)`, `fogGridWgsl(false)`, `AirShape.localFog`), culling and sky-term passes
  never made, no lists' buffer. Sky light cube face and reflection programs never have them.
- **Differences from reference** (local fog volume tiles):
  - Lists are a storage buffer, not a texture array (eighth and last of 8 of blend fragment stage,
    `gpu/core/stageLimits.test.ts`).
  - Cells find their tile by projecting their centre, as the reference's do.
  - No indirect tile draw: volumes are laid in the lighting; a tile with no volume is skipped by count.
  - Planes the sphere is tested against are divided by their length (reference compares undivided).
  - Pyramid verdict on a volume is found once for all tiles, not per tile thread.
  - No async switch; no debug view of counts.
  - Instance data is 32-bit floats, not packed (reference error up to 1.6 % on extinction).
  - No start-distance depth-bound optimisation.
  - Clouds find their tile with the de-jittered texel, culling uses the jittered matrix: at most a
    pixel's seam on a tile edge under temporal resolve, as the reference.
- **Block.** Six `vec4` of light buffer, behind irradiance (`FOG_SLOT`): colour and mode, law, range,
  lobe, sky factor, sun (direction toward it and luminance); local fog volumes' block follows in same
  buffer (`LIGHT_BUFFER_AT.localFog`).
