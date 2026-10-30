# Direct lighting

**Lit image passes** (`lighting/deferred/`; `DeferredLighting.light`, `litProgram.ts`), in order:

1. **Classification** (`classify.ts`, `classifyWgsl.ts`, one compute dispatch): an 8 × 8-pixel tile
   is listed under its most demanding class: `simple` (standard physical model alone), `single`
   (other model: diffuse, shading model such as toon, thin two-sided surface) or `complex`
   (anisotropic or clear-coat lobe). Background, unlit, as-is tiles: no list. Writes three lists and
   three indirect draws (`tileClass.ts`).
2. **Surface colour** (`colourPassWgsl.ts`, `surfaceColourMain`, fullscreen): background, as-is
   surface, unlit colour, lit surface's emission under ambient occlusion.
3. **Sun** (`lightPassWgsl.ts`, `sunPassWgsl`): directional lights by rank (`sunRanks`), with
   frame-mask shadow, clouds' shade, light function.
4. **Local lights** (`localPassWgsl`): the pixel's grid cell lights, not directional ones.
5. **Indirect light** (`indirectPassWgsl.ts`): environment and sky light diffuse, probes' bounce,
   reflection, thin surface's back (`thinBack`: screen probes' backface light, else sky irradiance).

Passes 3 to 5 draw tile quads, one indirect draw per class (`tilePass.ts`); programs hold only the
code a class needs (`CLASS_CUTS`): `simple` no diffuse model, shading model, thin transmission or
lobe; `single` no lobe. No directional light: no sun pass; only directional: no local pass
(`DirectLightResources.suns`, `locals`).

Passes add with blend one-one. Each pre-exposes its term (`preExposed`); base pass holds emission
alone (`preExposedClipped`); light passes unclipped. The sum isn't held (may pass 65504); temporal
resolve bounds the colour it reads (`LARGEST_SCENE_COLOR`, `post/taa/colorSpaceWgsl.ts`).

One light term (`declaredLight`) serves light passes and translucent surfaces. Then sky, height fog
(`lighting/fog/fogPass.ts`), surface and cloud haze
([Fog](fog.md#fog), [Atmosphere and sky light](atmosphere-and-sky-light.md#atmosphere-and-sky-light)),
transparents.

Single-term views (`lightView`, `LIT_VIEWS` in `visibility/shader/shadeMode.ts`) draw only the passes
giving that term: reflection (1) and bounced irradiance (4, `BOUNCE_LIGHT_VIEW`, `lightingView`
`'bounce'`): indirect pass; lighting on a white surface (3): three passes; shadows (2): a local-lights
pass showing the share shadows let through.

## Light grid and shadows

A light grid lists each cell's lights once per image (`lighting/tiles/`); each pixel walks its cell's
list (`lighting/direct/lightLoopWgsl.ts`). No shadowed light: no shadow code; no rectangle: no
rectangle code (`lighting/deferred/contractVariants.ts`); a casting rectangle is both.

Sun share = its layer of the suns' mask; local light share = its four bits of the pixel's mask, the
cell's shadowed local lights in list order (`vsmMaskLaneOf`), or, past the mask's lanes
(`shadowOnePassProjectionMaxLightsPerPixel`), one sample of its own map.
Shadows: [SHADOWS.md](../SHADOWS.md).

Grid cells: 64 pixels across, 32 slices deep (`gridSlices`, `LIGHT_SETTINGS`). Slice =
`log2(depth · B + O) · 4.05` (`gridDepthDistribution`), `B`, `O` solved per image
(`lighting/tiles/gridMap.ts`): first slice starts 9.5 cm past the near plane, last 10 cm past the
farthest local-light reach (at least 10 m and twice the near plane, at most 2 097 m: `gridFarFloor`,
`gridFarMax`). Beyond: last slice. Map heads the grid buffer (`GRID_HEAD_WORDS`). A cell the pool
has no room for walks every light.

## Translucent surfaces

A translucent surface reads each light's shadow in its own fragment
(`lighting/direct/shadowWgsl.ts`).

- Default (`shadowTranslucentQuality` 0): one sample of the light's map at the surface point, sun's
  only; a shadowed local light lights it whole (`shadowTranslucentLocalLights` off).
- Quality 1: opaque projection's trace, dithered in a penumbra.
- Both are project switches read at session open (`frame/prepare/setup.ts`), compiled into the
  translucent programs (`blend/pipelines.ts`).
- Pages read: opaque pixels' marked ones and, at quality 1, the sun's pages of the previous image's
  nearest translucent surface (`lighting/shadows/vsm/frame/vsmFrontLayer.ts`); missing: coarser level.
- A material can ask more (`translucentDirectionalLightShadowQuality`, `translucentLocalLightShadow`,
  `translucentLocalLightShadowQuality`); its marks ride the item's flags
  (`TRANSLUCENT_SHADOW_MARK`, `translucentMarksFrom`).
- A rectangle light is a point light at its centre for a translucent surface unless switch
  `translucentRectLights` is on (`blend/shader.ts:translucentLitKey`).

Settings:
[SDK.md](../sdk/lights/a-see-through-surface-reads-the-suns-shadow-with-one-sample.md#a-see-through-surface-reads-the-suns-shadow-with-one-sample).

## A lamp's term

A lamp's light at a point = mask × falloff.

- Mask: zero at range, one at centre (inverse-square window, or other law's
  `(1 - d²/R²)^exponent`), × spot fade: square of a saturated linear ramp in the cosine, outer to
  inner cone.
- Falloff: `1 / (d² + b)`, `b` 1 cm² on a surface, fog cell's own in a medium, none in bounce-cache
  light; non-inverse-square lamp: 1.
- Tube, sphere: source integral, horizon wrap (`emitterLength`, `emitterRadius`,
  `emitterSoftRadius`); wrap takes inverse square even where falloff is 1.
- Shares weigh the diffuse and specular parts; both 1: plain term.

Rectangle term = polygon integral × shadow share × colour translucent casters let through. A surface
the projection culls (normal past the horizon by more than the sine of the source's half angle) gets
zero shadow; a thin surface's back is lit from behind, normal flipped. Shadow catcher takes the
rectangle's energy as form factor. Surface cache lighting: one shadow ray through the global distance
field toward the centre; fog reads its shadow map where it sets `shadowsFog`.

A thin double-sided surface (`subsurfaceColor`) adds transmission to each light term
(`lighting/direct/thinTransmissionWgsl.ts`): surface colour × light energy × wrapped cosine
`(½ − N·L) / (3/2)²` held to 0..1 × GGX lobe α² 0.36 in the view-against-light cosine, `L` toward
the lamp centre (rectangle: its centre, energy = form factor). No 1/π, no front cosine; peak 0.589.

## Shadow terms

**One shadow-terms step per light** (`lighting/direct/shadowTermsWgsl.ts:shadowTermsOf`): a light's term has two scalars plus
the shadow itself.

- Surface shadow weighs the lobes (diffuse and specular of every model, rectangle's, profile's, eye
  specular): pixel occlusion `ao` where the light has no shadow bits, its shadow where it has some;
  mesh hair none.
  - Transmission shadow weighs transmitted terms (thin back, skin, subsurface, profile, hair tint,
  soft diffuse, eye diffuse): the shadow, 1 where the light has none.
- The shadow alone is the thickness a profile's optical depth and a subsurface colour read.
- Contact shadow multiplies the first two.

Translucent forward light loops (blend, transmissive layers, water) take occlusion 1.

A light's **shadow bits** (UE: `GetShadowedBits`), built per light on CPU into its kind word
(`LIGHT_FIELD.kind`, `LIGHT_SHADOWED_SHIFT`, `scene/light/fields.ts:kindWordOf`): 3 where it casts and the view's dynamic
shadows are on (shadow quality above 0), else 1 where it casts (static shadow) or wears a light
function with no atlas slot, else 0.

- Read via `lighting/direct/lightReachWgsl.ts:shadowBitsOf`; view dynamic shadows:
  `ContactShadowView.dynamicShadows`.
- Quality 0: a casting light's shadow replaces occlusion; no ray; a hair under it casts its short ray.
- Light with no slot for its function: shadow 1 replaces occlusion, no contact length; a hair under
  it gets a ray passing what shares its depth.

## Contact shadows

(`lighting/contactShadow/`.) Lit passes cast a short ray from each pixel toward each light through
scene depth: eight steps, first jittered by interleaved gradient noise at the temporal phase, depth
margin twice a step's depth. Own-texel steps skipped, off-screen hit = miss, first hit decides.

- Share passing = `1 − intensity`: `contactShadowCastingIntensity` (1) where the hit casts contact
  shadows (all but eyes), `contactShadowNonCastingIntensity` (0) where not.
- Ray length = light's `contactShadowLength` (0: none; only a shadow-casting light has one), in
  screen units (share of screen height at the pixel depth) or, with
  `contactShadowLengthInWorldSpace`, metres.
- Eye-model pixel: 0.5 cm toward every light; hair-model pixel, under a light with no shadow bits, a
  fifth of half screen height at its depth (ray also hits what shares its depth); neither follows the
  view switch.
- Thin subsurface, subsurface, skin: light passes `e^(−density · distance)`, density from opacity
  (`subsurfaceDensity`); profile, hair, eye: first hit blocks.

A hit casts unless eye model or its object sets `castContactShadow = false`
(`offsetSwitches.ts` → `PLACEMENT_NO_CONTACT_SHADOW` in the placement record → page `PageInfo.marks`,
beside `PLACEMENT_FIRST_PERSON` → `withPageMarks` → `NO_CONTACT_SHADOW_SURFACE_FLAG`, bit 16, stored
inverted so a flags word without it casts: `hitCastsContactShadow`).

Numbers fold per light on CPU (`scene/light/contactShadowView.ts:writeContactShadow`): the light's
own, each replaced by the view override when it is 0 or more, length negative in metres and doubled in
screen units; switch off: no ray, intensities 1 and 0. A ray that can't darken (length 0, or both
intensities 0) is length 0.

Light record = 32 floats:

- seventh `vec4`: `contactGi`: length, two intensities, indirect lighting factor
  (`LIGHT_FIELD.contactGi`);
- eighth `vec4`: `x` exposure blend (`LIGHT_FIELD.exposureBlend`, applied in `lightStrength`),
  `y` half tube length
  (`LIGHT_FIELD.tubeHalfLength`; unit tube axis = `xyz` of the fifth `vec4`,
  `LIGHT_FIELD.emitterAxis`), `z` source weight in its lobes (`LIGHT_FIELD.sourceTerm`: sun's disk
  sine, point's or spot's rough diffuse weight), `w` free.

Kind word = `u32` in `x` of the light's `params`:

- rank (bits 0-1); flags (casts shadow, shadows fog, transmits; bits 2-4);
- lighting channels (`LIGHT_CHANNELS_SHIFT`); shadow bits (`LIGHT_SHADOWED_SHIFT`);
- light profile lane (`LIGHT_PROFILE_SHIFT`); light function index (`LIGHT_FUNCTION_SHIFT`);
- undrawn bit (`LIGHT_UNDRAWN_SHIFT`; CPU, `lightDrawn`); marker bit 23 (`LIGHT_KIND_MARKER`);
  shaders read it with `bitcast<u32>` via `kindWord`, which masks it.

Draw range (greatest draw distance) is CPU-only, in the store's own lanes (`SceneLightStore.draw`).

Frame reads the view's five settings at image entry (`followContactShadows`) into
`SceneLightStore.setContactShadowView` (rewrites every light's contact lanes). Rays go toward the
light centre, tube lamps included. Settings are the world's (`runtime/settingFamilies.ts`, `shadows`
family, `world: 'image'`; `ViewOverrides` holds no shadow setting). View uniform (`VIEW_LAYOUT`)
carries the camera's forward axis and field.

A program holds the code (`ContractKey.contactless`) when a light casts a ray of its own under the
view's folded settings, or a surface may be eye or hair model. Translucent programs hold it only for
a scene with a `contactShadows` surface lit by the forward light loop or transmissive
(`materials/surface/blendLightSource.ts:contactShadowsOf`; cut = `TranslucentScene`; UE
`MATERIAL_CONTACT_SHADOWS`); no water. There the ray is a fifth of
half screen height at the pixel depth toward every light, from a fragment whose material asks
(`MATERIAL_FLAG.contactShadows`, read by `contactShadowsAsked`).

Reads: lit passes bind depth and flags (`contactSceneDepth`, `contactSceneFlags`,
`lighting/deferred/litSurfaceWgsl.ts`); blend pass reads
opaque depth (pyramid level 0) and surface flags (`BLEND_BINDINGS.surfaceFlags`; sampled textures
15 of 16, storage buffers 8 of 8; `blend/contactSceneWgsl.ts`). Lit view (`View`, group 1) gives the
matrices. Transmissive stages set the ask before they light (`thinAdd`). Single-layer water never
asks (not a translucent blend mode in UE; must be opaque or masked, `MaterialShared.cpp`). Settings:
[SDK.md](../sdk/lights/contact-shadows.md#contact-shadows).

<!-- wave-1: W1-1/W1-3/W1-9 docs pending -->
