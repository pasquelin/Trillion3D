# Toon shading

**The toon shading model** (`sdk-core/src/lighting/toonProfile/`, `lighting/toon/`,
`lighting/direct/toonModelWgsl.ts`, `sdk-core/src/lighting/ggxMaxSpec.ts`). `material.meshToon` is a
standard surface of the toon model, shading model number 12 (`PIXEL_MODEL.toon`, record code 7,
`shadingModel: 'toon'`; no graph picks it): the closure replaces the physical model's diffuse and
specular lobes, whatever the light, a lamp's (`toonLampLight`) or a rectangle's (`toonRectLight`).

_Profile_: a row of 256 (`toonProfile`, the default profile's row 0): three ramps sampled at the
centres of 64 texels (diffuse over `N·L / 2 + 1 / 2`, specular over the lobe, the specular indirect
ramp over the fraction of the repeated luminance of the reflections), the shadow hatching's
distribution ramp, and the parameters (among them the scales of diffuse and specular indirect light
and the ramp's repetition; the shadow extinction is not among them, it lies by row in the
projection's view).

_Toon buffer_ (`lighting/toon/buffer.ts`, `toonTablesOf`): the parameters, with the toon specular's
peak table, live in a buffer of their own: a header (where the patterns start, the resolution, the
words of a row), the peak table, the rows as half floats and floats (`toonLayout`, `packToonRow`,
written when the profiles change, `followToonProfiles`) and the pattern slots, sized from the
profiles the materials hold (a header of four words while no material is toon; rows and slots rounded
up to a power of two). The lit passes that light toon pixels bind it (`toonTablesBinding`,
`DEFERRED_BINDINGS.toonTables`); other programs read zeros (`TOON_TABLES_NONE_WGSL`).

_Baking_: ramps and patterns are baked at `toonProfileResolution` texels (64 to 512, a multiple of
8). A profile's images (the two offsets, the hatching) are baked by a compute pass (`TOON_BAKE_WGSL`)
into one of 16 pattern slots, each texel taken at level 0, repeating, at the centre of a texel inside
a ring of one texel (two texels fewer than the resolution), and read bilinearly, once all the
profile's images are decoded (a profile with an image still loading is lit plainly meanwhile).

_Per pixel_: the record's profile byte holds the toon profile's row; the thin transmission's target
holds the row and the fraction of ten times its first texture coordinates (the pattern coordinates).
The shadow extinction per centimetre of each profile row lies in the projection's view uniform
(`VsmProjectionView.toonExtinction`, written while a material is toon); by it the virtual shadow maps
let light through a toon receiver (`vsmSubsurfaceShadow`: the light surviving the occluder distance
`exp(-distance · extinction)`, added to the share the rays missed and squared like a subsurface
receiver's).

_Per light_: the transmittance is the light's shadow, drawn as the hatching's four channels along the
distribution ramp where the profile wears an image. The diffuse is the diffuse colour times the
diffuse ramp at `N·L / 2 + 1 / 2` (times the transmittance when the profile includes the shadow) plus
the offset image's, over π, times the transmittance otherwise. The specular is the lobe's value at the
half vector (GGX, or the pixel's anisotropic lobe) times the factor of the peak table (a 32 × 32 table
of four values, roughness across, anisotropy down, one value per each of four view cosines, of
`1 / (π · max)` of the lobe over the visible normals, built by `ggxMaxSpec.fixture.ts`) through the
specular ramp, times the specular colour, surface shadow and cosine.

_Unified diffuse_: with `toonUnifiedDiffuse` (and a toon material in the scene:
`DirectLightResources.toonUnified`) the frame is lit by the program that writes the toon data
(`ContractKey.toonData`, a table of programs of its own in `createContractVariants`, no cut). The lit
image's pass has two more targets (`TOON_DATA_FORMATS`: `rgba16float` for the pre-exposed diffuse
light, `rg16float` for the weight and weighted cosine, cleared with the image, additive), and every
light draw (sun's, batched local lights', each per-light draw, the sampled lighting's) leaves its toon
light unramped there (`toonLightOut`, `TOON_DATA_OUT_WGSL`) with its own shadows, the diffuse left out
of the colour target. After the lights the pass ends and a pass over the image's one target reads the
data (`toonMain`, `toonApplyDiffuse`, over the toon tiles): the ramp applied once to the sum at the
cosine the weights average to, plus the offset, added to the image.

_Indirect_: the diffuse indirect light is scaled by the profile's `diffuseIndirectScale`
(`modelDiffuse`). A toon pixel's reflections are scaled by the profile's `specularIndirectScale` and,
with the setting `toonReflectionQuantization` and a repetition above 0, quantised
(`toonIndirectSpecular`: the logarithm of the light, its value repeated and read in the profile's
specular indirect ramp).

