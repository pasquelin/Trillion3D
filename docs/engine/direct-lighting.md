# Direct lighting

**The lit image's passes** (`lighting/deferred/`). The lighting draws the lit image in passes, one per
part of its sum, each over the pixels that need it, in this order (`DeferredLighting.light`,
`litProgram.ts`):

1. **The classification** (`classify.ts`, `classifyWgsl.ts`, one compute dispatch): a workgroup reads
   the surface flags of a tile of 8 × 8 pixels and puts the tile in the list of the most demanding
   class of its pixels: `simple` (the standard physical model alone), `single` (another model: the
   diffuse, a shading model such as the toon, or a thin two-sided surface) or `complex` (an
   anisotropic or clear-coat lobe). A tile of background, unlit and as-is pixels is in no list. It
   writes the three lists and the arguments of the three indirect draws (`tileClass.ts`).
2. **The surface colour** (`colourPassWgsl.ts`, `surfaceColourMain`, a fullscreen draw that writes
   every pixel): the background where no surface was drawn, a surface shown as it is, an unlit
   surface's colour, and a lit surface's emission under the ambient occlusion.
3. **The sun** (`lightPassWgsl.ts`, `sunPassWgsl`): the scene's directional lights, by their ranks in
   the light buffer (`sunRanks`, written with the buffer), each with its shadow read in the frame's
   mask, the clouds' shade and its light function, added to the image.
4. **The local lights** (`localPassWgsl`): the lights of the pixel's cell of the light grid, the
   directional ones left to the sun, added to the image.
5. **The indirect light** (`indirectPassWgsl.ts`): the environment's and the sky light's diffuse light,
   the probes' bounce, the reflection and a thin surface's back (`thinBack`: the screen probes'
   backface light where they left one in the pixel, else the sky light's irradiance), added to the
   image.

Passes 3 to 5 draw tile quads, one indirect draw per class (`tilePass.ts`), each class with a program
that holds only the code its pixels need (`CLASS_CUTS`): the `simple` one no diffuse model, no shading
model, no thin transmission and no lobe, the `single` one no lobe. A scene with no directional light
draws no sun's pass, one with only directional lights no local lights' pass
(`DirectLightResources.suns`, `locals`, the store's counts).

They add with a blend of one and one over the image. Every pass pre-exposes its term (`preExposed`) and
holds it not: the base pass holds the emission alone (`preExposedClipped`), as the reference's does,
and the light passes multiply by the pre-exposure with no clip, so the image is the sum of the passes'
terms. The sum is not held, for a blend cannot read what it adds to: a pixel whose terms add to more
than the 65504 a half float holds passes it; the temporal resolve bounds the colour it reads for that
(`LARGEST_SCENE_COLOR`, `post/taa/colorSpaceWgsl.ts`).

One light term serves the two light passes and the translucent surfaces (`declaredLight`): the walk
around it is the only difference. The sky, the height fog (`lighting/fog/fogPass.ts`), the haze on the
surfaces and the clouds follow ([Fog](fog.md#fog),
[Atmosphere and sky light](atmosphere-and-sky-light.md#atmosphere-and-sky-light)), then the
transparents.

A view of one lighting term (`lightView`, `LIT_VIEWS` in `visibility/shader/shadeMode.ts`) draws only
the passes that give it, the surface black before them:

- the reflection (1) and the bounced irradiance alone (4, `BOUNCE_LIGHT_VIEW`, asked by the host with
  `lightingView` `'bounce'`): only the indirect pass;
- the lighting on a white surface (3): the three passes;
- the shadows (2): a pass of the local lights' program that shows the share of the light the shadows
  let through.

## Light grid and shadows

Any number of lights: a light grid lists each cell's lights once per image (`lighting/tiles/`), and each
pixel walks its cell's whole list (`lighting/direct/lightLoopWgsl.ts`), moving or still. The shadow rays
are the projection's, paid once, so the lighting never draws a subset. A frame with no shadowed light
runs a program built without the shadow code, and one with no rectangle a program built without the
rectangle code (`lighting/deferred/contractVariants.ts`); a rectangle that casts counts as a shadowed
local light, and as a rectangle.

A sun's share is its layer of the suns' mask at the pixel; a local light's is its four bits of the
pixel's mask, the lane of the shadowed local lights of its cell in the order the cell lists them
(`vsmMaskLaneOf`), or, past the lanes the mask keeps (`shadowOnePassProjectionMaxLightsPerPixel`), one
sample of its own map. Shadows are [SHADOWS.md](../SHADOWS.md).

The grid's cells are 64 pixels across and 32 slices deep (`gridSlices`, `LIGHT_SETTINGS`). The slice of
a depth is `log2(depth · B + O) · 4.05` (`gridDepthDistribution`), `B` and `O` solved each image
(`lighting/tiles/gridMap.ts`) so that the first slice starts 9.5 cm past the near plane and the last 10
cm past the farthest reach of a local light along the view axis (at least 10 m and twice the near
plane, at most 2 097 m: `gridFarFloor`, `gridFarMax`). Every light and pixel beyond is in the last
slice, so no light is dropped. The map heads the grid's buffer (`GRID_HEAD_WORDS`), where the pass and
every reader of a list find it. A cell the pool has no room for walks every light, exactly.

## Translucent surfaces

A translucent surface, which no mask holds, reads each light's shadow in its own fragment
(`lighting/direct/shadowWgsl.ts`).

- By default (`shadowTranslucentQuality` 0) that is one sample of the light's map at the surface's
  point, and only the sun's: a shadowed local light lights it whole (`shadowTranslucentLocalLights`
  off) and its program holds none of the local lights' read.
- At quality 1 it is the opaque projection's own trace, run for the fragment and dithered in a
  penumbra.
- Both are project switches read once when the session opens (`frame/prepare/setup.ts`), compiled into
  the translucent programs (`blend/pipelines.ts`). The pages they read are those the opaque pixels
  marked and, at quality 1, the sun's pages of the nearest translucent surface the image before drew
  in front of each pixel, which the marking pass reads from the depth pyramid's front layer
  (`lighting/shadows/vsm/frame/vsmFrontLayer.ts`); a page none holds falls back to the next coarser
  level.
- A material can ask more of its own (`translucentDirectionalLightShadowQuality`,
  `translucentLocalLightShadow`, `translucentLocalLightShadowQuality`): its marks ride the item's flags
  (`TRANSLUCENT_SHADOW_MARK`, `translucentMarksFrom`) and the programs of a scene whose surfaces ask
  nothing hold none of that code.
- A rectangle light lights a translucent surface as a point light at its centre unless the switch
  `translucentRectLights` is on, the programs then holding none of the rectangle shading
  (`blend/shader.ts:translucentLitKey`).

[SDK.md](../sdk/lights/a-see-through-surface-reads-the-suns-shadow-with-one-sample.md#a-see-through-surface-reads-the-suns-shadow-with-one-sample)
tells the settings.

## A lamp's term

A lamp's light at a point is its mask times its falloff.

- The mask is zero at its range and one at its centre (the inverse square's window, or the other law's
  `(1 - d²/R²)^exponent`), times a spot's fade, the square of a saturated linear ramp in the cosine
  from the outer cone to the inner one.
- The falloff is `1 / (d² + b)` with `b` a square centimetre on a surface, the fog cell's own in a
  medium, and none in the light a bounce cache stores; a lamp that is not the inverse square has a
  falloff of one.
- A tube and a sphere have the integral and the horizon wrap of their source (`emitterLength`,
  `emitterRadius`, `emitterSoftRadius`); the horizon wrap takes the inverse square even where the
  falloff is one.
- Where a sum is nothing (a point at the lamp's own centre, with no bias) the reciprocal is nothing,
  never an infinity: that point takes no light from the lamp.
- The shares weigh the diffuse and the specular parts of the term; both at one, the term is the plain
  one.

A rectangle's term is its integral over the polygon times its shadow's share and the colour the
translucent casters let through. Its shadow is read where the projection traced it: a surface the
projection culls (its normal further past the horizon than the sine of the half angle of the
rectangle's source, half its width) is the exact zero; a thin surface's back is lit from behind and its
normal flipped for the read, as a lamp's. A shadow catcher takes the rectangle's energy as its form
factor with no normal. The surface cache's lighting tests a rectangle that casts by one shadow ray
through the global distance field toward its centre, as any light, and the fog reads its shadow map
where it sets `shadowsFog` (below).

A thin double-sided surface (`subsurfaceColor`) adds a transmission to each light's term
(`lighting/direct/thinTransmissionWgsl.ts`): the surface's colour times the light's energy times a
wrapped cosine, `(½ − N·L) / (3/2)²` held to 0..1, times a GGX lobe of α² 0.36 in the cosine of the view
against the light, `L` the direction toward the lamp's centre (the rectangle's centre, its energy its
form factor with no normal). It has no 1/π and no cosine of the front's: its peak is 0.589, and it
reaches the lit front up to a cosine of one half. The light's shadow is read once, for the front's term
and this one.

## Shadow terms

**One shadow-terms step per light** (`lighting/direct/shadowTermsWgsl.ts:shadowTermsOf`). After its
shadow read and its contact shadow, a light's term has two scalars and the shadow itself, handed to the
lobes and the models alike.

- The surface shadow weighs the lobes (the diffuse and specular of every model, the diffuse model and
  the toon's included, a rectangle's, the profile's, the eye's specular): it is the pixel's occlusion
  `ao` where the light has no shadow bits, and its shadow where it has some. A mesh's hair is lit with
  an opaque visibility of 1, as the reference's default transmittance data has it: the surface shadow
  weighs no part of it.
- The transmission shadow weighs the transmitted terms (the thin back, the skin's, the subsurface's,
  the profile's, the hair's tint and soft diffuse, the eye's diffuse): the shadow, 1 where the light
  has none.
- The shadow alone is the thickness a profile's optical depth and a subsurface's colour read.
- The contact shadow multiplies the first two.

The forward light loop of the translucent stages (the blend, the transmissive layers, the water) takes
an occlusion of 1: the material's occlusion weighs the indirect light and the environment there, not
the lights.

A light's **shadow bits** are the reference's (`GetShadowedBits`), built on the CPU, per light, and kept
in its bits lane (two bits of the light's kind word, `LIGHT_FIELD.kind`, above its lighting channels,
`LIGHT_SHADOWED_SHIFT`, `scene/light/fields.ts:kindWordOf`): 3 where it casts and the view's dynamic
shadows are on (the shadow quality is above 0, which the reference's show flag reads), else 1 where it
casts (its static shadow) or wears a light function that holds no slot of the atlas, else 0. A light
that casts has bits of at least 1 at every shadow quality.

- The shader reads them from the record (`lighting/direct/lightReachWgsl.ts:shadowBitsOf`); the view's
  dynamic shadows ride the view of the contact shadows (`ContactShadowView.dynamicShadows`, read once
  an image in `lighting/contactShadow/frame.ts:followContactShadows`), which re-packs the lights' words
  and publishes the epoch when it changes.
- At quality 0 a light that casts has its shadow, not the occlusion, for its surface shadow, casts no
  ray of its own, and a hair under it casts its short ray.
- A light with no slot for its function has its shadow, 1, in place of the occlusion, its contact
  length none, and a hair under it a ray that passes what shares its depth.
- A pixel with no occlusion (`ao` 1) and no contact shadow is unchanged to the last operation of the
  lobes.

## Contact shadows

(`lighting/contactShadow/`.) The lit passes cast a short ray from each pixel toward each light through
the scene's depth: eight steps, the first jittered by the pixel's interleaved gradient noise at the
temporal phase, each compared to the depth with a margin of twice a step's depth. A step on the depth
of the pixel's own texel is skipped, a hit off the screen is a miss, and the first hit decides.

- The share of the light that gets past is `1 − intensity`: the light's `contactShadowCastingIntensity`
  (1) where the surface hit casts contact shadows (every surface but an eye's), its
  `contactShadowNonCastingIntensity` (0) where it does not.
- The ray's length is the light's `contactShadowLength` (0: none), in screen units (a share of the
  screen's height at the pixel's depth) or, with `contactShadowLengthInWorldSpace`, in metres, and only
  a light that casts a shadow has one.
- Beside the lights' own, the models fix two: a pixel of the eye model casts half a centimetre toward
  every light, and one of the hair model, under a light with no shadow bits, a fifth of the half height
  of the screen at its depth (the ray then also hits what shares its depth); neither follows the view's
  switch.
- A pixel of the thin subsurface, subsurface or skin model lets through the light that travels the hit
  distance through its material, `e^(−density · distance)` of the density its opacity gives
  (`subsurfaceDensity`, which the shadow maps' receiver reads too); the profile, the hair and the eye
  take the first hit as a blocker.

A hit casts contact shadows unless it is of the eye model or its object sets
`castContactShadow = false`. The object's bit travels from the node's switches (`offsetSwitches.ts`) in
its placement's record (`PLACEMENT_NO_CONTACT_SHADOW`), copied as it is into the page (`PageInfo.marks`,
beside `PLACEMENT_FIRST_PERSON`) and, in the resolve (`withPageMarks`), onto the flags of every surface
it draws (`NO_CONTACT_SHADOW_SURFACE_FLAG`, bit 16; a held-out object's included). The flat diagnostic
stages bypass the resolve and carry no mark, those views lighting nothing. It is stored inverted (set
where the object lets the rays through) so that every flags word that carries it not (the sky's, a
pass's other than the resolve's, a default object's) casts, as the reference's bit does by default
(`hitCastsContactShadow`).

The numbers are folded per light on the CPU, as the reference builds a light's data
(`scene/light/contactShadowView.ts:
writeContactShadow`): the light's own, each replaced by the view's override that is 0 or more (the
length with its own unit), the length negative in metres and doubled in screen units, no ray and the
intensities 1 and 0 with the switch off. A ray that cannot darken (a length of 0, or both folded
intensities 0) is a length of 0 (the lights that cast one are counted under the same rule).

The light's record is 32 floats:

- The seventh `vec4` holds `contactGi`: the length, the two intensities and the indirect lighting
  factor (`LIGHT_FIELD.contactGi`).
- The eighth `vec4` holds the exposure blend (`LIGHT_FIELD.exposureBlend`, its `x`, applied where the
  light is read, `lightStrength`), half the length of the light's tube (`LIGHT_FIELD.tubeHalfLength`, its
  `y`; its unit axis, the tube's line and the one a light profile's angle runs round, is the `xyz` of
  the fifth `vec4`, `LIGHT_FIELD.emitterAxis`), the weight of the light's source in its lobes
  (`LIGHT_FIELD.sourceTerm`, its `z`: a sun's disk sine, a point's or a spot's rough diffuse weight), its
  `w` left free.

The draw range of a light (the share of the screen under which it is left out, its greatest draw
distance) is the CPU's alone and sits in the store's own lanes (`SceneLightStore.draw`).

The kind word is a `u32` whose bits sit in the `x` of the light's `params`:

- the rank (bits 0-1);
- the flags (casts a shadow, shadows the fog, transmits; bits 2-4);
- the lighting channels stored (`LIGHT_CHANNELS_SHIFT`);
- the shadow bits (`LIGHT_SHADOWED_SHIFT`);
- the light profile's lane (`LIGHT_PROFILE_SHIFT`);
- the bit the view sets where it leaves the light out (`LIGHT_UNDRAWN_SHIFT`: set on the CPU once a
  view, `lightDrawn`; read by the light grid and the walks of every light);
- the light function's index (`LIGHT_FUNCTION_SHIFT`);
- under a constant marker bit (`LIGHT_KIND_MARKER`, bit 23) that keeps the lane a normal float.

The shaders read it with `bitcast<u32>`, through the one accessor `kindWord`, which masks the marker.

The frame reads the view's five settings at the image's entry
(`lighting/contactShadow/frame.ts:followContactShadows`, with the other settings, before the lit
program's key is read) and hands them to the store (`SceneLightStore.setContactShadowView`), which
writes the contact lanes of every light again, and publishes the epoch as a change of the air does,
when one moved. A light's own contact edit is the same: its lanes are written and the epoch published,
its revision stays, so no shadow page of it is staled. The rays go toward the light's centre, a tube
lamp's included. The settings are the world's, one set for every view that draws the store's one buffer
(`runtime/settingFamilies.ts`, the `shadows` family, `world: 'image'`; `ViewOverrides` holds no shadow
setting). The view uniform carries the matrix the surfaces were drawn with and the camera's forward
axis and field (`VIEW_LAYOUT`).

A program holds the code (`ContractKey.contactless`) when a light casts a ray of its own under the
view's folded settings, or a surface may be of the eye or hair model. The translucent programs hold it
only for a scene that holds a surface with `contactShadows` that is lit by the forward light loop or is
transmissive (`materials/surface/blendLightSource.ts:contactShadowsOf`; their cut is the scene's,
`TranslucentScene`), as the reference compiles `MATERIAL_CONTACT_SHADOWS` for the materials of a
translucent blend mode that ask, and no water. There the ray is a fifth of the half height of the screen
at the pixel's depth toward every light, whatever the light says, from a fragment whose material asks
(the record's `MATERIAL_FLAG.contactShadows`, read from the surface's record by `contactShadowsAsked`);
a fragment that does not ask casts none, the lights' own rays and the models' being the lit passes'.

A pass gives the ray its reads:

- the lit passes the depth and the flags they bind (`contactSceneDepth`, `contactSceneFlags`,
  `lighting/deferred/litSurfaceWgsl.ts`);
- the blend pass the opaque depth in level 0 of the depth pyramid, bound already in the forward
  programs' reflection group, and the opaque surfaces' flags through a read-only storage texture
  (`BLEND_BINDINGS.surfaceFlags`, the fourth and last of the fragment stage's storage textures; the
  sampled textures stay at 15 of 16 and the storage buffers at 8 of 8; `blend/contactSceneWgsl.ts`).

The lit view (`View`, group 1) gives the matrices. The transmissive stages set the ask before they light
(`thinAdd`); the single-layer water never does, it is no translucent blend mode in the reference (a
single-layer water must be opaque or masked, `MaterialShared.cpp`). The view's settings are shadow
settings ([SDK.md](../sdk/lights/contact-shadows.md#contact-shadows)).

<!-- wave-1: W1-1/W1-3/W1-9 docs pending -->
