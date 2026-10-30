# Toon shading

**The toon shading model** (`sdk-core/src/lighting/toonProfile/`, `lighting/toon/`,
`lighting/direct/toonModelWgsl.ts`, `sdk-core/src/lighting/ggxMaxSpec.ts`). `material.meshToon` is a
standard surface of the toon model, shading model number 12 (`PIXEL_MODEL.toon`, record code 7,
`shadingModel: 'toon'`; no graph picks it). It replaces the physical diffuse and specular lobes for
any light (`toonLampLight`, `toonRectLight`).

_Profile_: a row of 256 (`toonProfile`, default profile row 0): three ramps of 64 texels (diffuse
over `N·L / 2 + 1 / 2`, specular over the lobe, specular indirect over the fraction of the repeated
reflection luminance), the shadow hatching's distribution ramp, and the parameters (indirect scales,
the ramp's repetition, ...).

_Toon buffer_ (`lighting/toon/buffer.ts`, `toonTablesOf`): header, specular peak table, rows
(`toonLayout`, `packToonRow`, `followToonProfiles`), pattern slots. Bound by lit passes
(`toonTablesBinding`, `DEFERRED_BINDINGS.toonTables`); other programs read zeros
(`TOON_TABLES_NONE_WGSL`).

_Baking_: ramps and patterns are baked at `toonProfileResolution` texels (64 to 512, a multiple of
8). A profile's images (two offsets, hatching) bake (`TOON_BAKE_WGSL`) into one of 16 pattern slots
(level 0, repeating, read bilinearly, at the centre of a texel inside a ring of one texel, two
fewer than the resolution) once decoded; until then the profile is lit plainly.

_Per pixel_: the record's profile byte holds the profile's row; the thin transmission's target holds
the row and the fraction of ten times the first texture coordinates (pattern coordinates). Shadow
extinction per centimetre of each row is in `VsmProjectionView.toonExtinction`; virtual shadow maps
pass light through a toon receiver (`vsmSubsurfaceShadow`: `exp(-distance · extinction)`, squared
like a subsurface receiver's).

_Per light_:

- Transmittance: the light's shadow, drawn as the hatching's four channels along the distribution
  ramp where the profile wears an image.
- Diffuse: diffuse colour times the diffuse ramp at `N·L / 2 + 1 / 2` (times the transmittance if
  the profile includes the shadow) plus the offset image's, over π, times the transmittance
  otherwise.
- Specular: the lobe at the half vector (GGX, or the anisotropic lobe) times the peak table's factor
  (32 × 32 table of four values: roughness across, anisotropy down, four view cosines;
  `1 / (π · max)` of the lobe; `ggxMaxSpec.fixture.ts`) through the specular ramp, times specular
  colour, surface shadow and cosine.

_Unified diffuse_: with `toonUnifiedDiffuse` (and a toon material in the scene:
`DirectLightResources.toonUnified`) the lit program writes toon data
(`ContractKey.toonData`, its own program table in `createContractVariants`): two more additive
targets (`TOON_DATA_FORMATS`: `rgba16float` pre-exposed
diffuse light, `rg16float` weight and weighted cosine) take every light's unramped toon light
(`toonLightOut`, `TOON_DATA_OUT_WGSL`), the diffuse left out of the colour target. After the lights a pass over the toon
tiles (`toonMain`, `toonApplyDiffuse`) ramps the sum once at the mean cosine, plus the offset, into
the image.

_Indirect_: diffuse indirect light is scaled by `diffuseIndirectScale` (`modelDiffuse`), reflections by
`specularIndirectScale` and, with `toonReflectionQuantization` and a repetition above 0, quantised
(`toonIndirectSpecular`: log of the light, repeated, read in the specular indirect ramp).
