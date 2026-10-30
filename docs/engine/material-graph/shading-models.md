# Shading models

**Shading model per pixel** (`materials/graph/outputsOf.ts`, `visibility/shader/shadeGraphWgsl.ts`,
`GRAPH_SHADING_MODELS`). Where material says `fromMaterialExpression` (`VisMaterial.modelFromGraph`,
`isCompiled`) and an opaque or masked lit surface's graph wires `shadingModel`, its resolve program
computes `mgModel` (output rounded, reference numbering) after other outputs. Unlit pixel shows
emission (`rgb` = emission) and leaves surface flags unlit. Thin transmission (`subsurfaceColor`)
kept only for `subsurface` and `twoSidedFoliage`; clear coat only for `clearCoat`; cloth lobe
(`cloth`, fuzz colour `subsurfaceColor`) only for `cloth`, in the lobe record the graph writes
(`physicalRecord.sheen`, packed by `clothTexel`). Graph wiring `cloth` and no model keeps cloth on,
no thin transmission. Transparent pass reads none.

**Shading model without a graph** (`visibility/shader/materialModelWgsl.ts`,
`MaterialParameters.shadingModel`). Record model word: code (bits 29-31: skin, profile, eye, hair,
unlit, thin subsurface, toon), profile (bits 20-27), subsurface opacity byte (eye's = one minus iris
mask); record carries eye iris distance (`irisDistance`, one more word: record is eleven texels).
Hair takes page tangent in normal's place, unlit pixel its emission alone.

**GGX energy table and preintegrated environment BRDF**
(`sdk-core/src/lighting/shadingEnergy.ts`, `lighting/direct/energyTermsWgsl.ts`;
`sdk-core/src/lighting/environmentBrdf.ts`, `lighting/direct/environmentBrdfWgsl.ts`). What a surface
keeps of environment light (probes', screen's, trace's, ambient cubemap's, coat's share:
`reflectionWeight`, `coatLayerKeep`) is `energyTerms`: `W · (f0 · E + (f90 − f0) · Ef)` read at
(N·V, perceptual roughness) from a 32 × 32 table of two 16-bit values (`E` = lobe albedo under
Fresnel 1, `Ef` = its share under Fresnel's fifth power), `W = 1 + f0 · (1 − E) / E`. Texel = mean
over 2^14 Owen-scrambled Sobol points (`math/src/sequence/owenSobol.ts`), held as data
(`shadingEnergyTable.ts`, written by `node packages/sdk-core/src/lighting/shadingEnergy.fixture.ts`),
in light buffer after environment BRDF (`LIGHT_BUFFER_AT.shadingEnergy`), read bilinear,
edge-clamped.

- Diffuse colour not darkened by lobe; direct lights not compensated.
- `f90` = `clamp(50 · f0.g)` (`envBrdfF90`) for opaque composite, `clamp(50 · max f0)` (`slabF90`)
  for slab's.
- Only single-layer water reflection is weighed by preintegrated environment BRDF `f0 · A + f90 · B`
  from a 128 × 32 table (`A` under Fresnel 1, `B` under its fifth power, 128 stratified samples per
  texel, `LIGHT_BUFFER_AT.envBrdf`).
- Rectangles' fitted lobe (`ltcTable.ts`) keeps own split-sum (`rectLtc`).

**Preintegrated skin, subsurface profile, hair, eye** (`materials/surface/pixelModel.ts`,
`lighting/direct/shadingModelWgsl.ts`, `surfaceModelTerms.ts`). Pixel whose `mgModel` is 3, 5, 7 or 9
keeps physical model in low three bits of surface flags and carries its number in bits 25 to 28
(`PIXEL_MODEL_SHIFT`); pixel with a model is `single` tile class (`pixelTileClass`), so the
`simple` class's programs hold none of it.
What a model
reads beyond surface values is left in thin transmission target, texel written without sheet flag
(`SUBSURFACE_FLAG` marks a back-lit sheet):

- skin: `subsurfaceColor` and `opacity`;
- subsurface profile: its number (material `subsurfaceProfile`, record model word,
  `subsurfaceProfileOfModel`) and `opacity` (pixel at or under `SUBSURFACE_OPACITY_THRESHOLD`, 0.1,
  keeps plain model);
- eye: profile number in `x`, one minus iris mask in opacity, distance in metalness, octahedral iris
  direction in `y`, `z`; or, with `irisNormal` (`uni.irisNormal`, `MODEL_SWITCH` bits of
  `view.views.w`), iris normal and caustic normal as octahedral differences from surface's, caustic's
  first in metalness and second in specular byte (lobe held at 0.25).

Target made when a surface's graph wires `shadingModel` (`writesSubsurfaceTarget`).
`litPixelStatements` reads number and texel once (`setPixelModel`). In light term
(`declaredLightWgsl`) a model term joins `transmitted` (`modelTransmission`):

- skin reads preintegrated table, imported image `skinTable.bin`, in light buffer after rectangles'
  lobe (`LIGHT_BUFFER_AT.skin`), written when a scene holds a graph with a shading model
  (`followSkinTable`);
- hair gives own BSDF alone (no diffuse, no specular), weighed by light's specular share;
- eye gives own diffuse over a specular lobe with grazing reflectance one (`modelLobeSurface`;
  `sphereHalfCosines`).

Indirect diffuse colour passes through `modelDiffuse` beside cloth hook (`clothDiffuse`): skin adds
its subsurface colour, hair is its response to environment. Hair reflects nothing
(`surfaceReflects`). Eye iris values and clear coat bottom normal are `unorm8` steps of 1/255, iris
and caustic normals' octahedral differences halved (`*0.5 + 128/255`), coat bottom-normal difference
quartered (`*0.25 + 128/255`, `clearCoatNormal`, `uni.clearCoatNormal`: pixel normal then coat's,
`coatBase`; `MODEL_SWITCH.clearCoatNormal`, `sphereNoNewton`). Skin shadow, as thin transmission's,
is shadow maps' own with the light a subsurface receiver lets through (`vsmSubsurfaceShadow`,
`docs/SHADOWS.md`); subsurface profile, hair, eye read from any side, not back-face culled
(`vsmSubsurfaceModel`).

Subsurface-profile pixel takes light term of `profileModelWgsl.ts` instead of plain lobes: Burley
diffuse (`profileBurley`) and specular of two GGX lobes (`profileSpecular`, from profile dual
specular, one `vec4` per profile in light buffer, `LIGHT_BUFFER_AT.profiles`,
`followSubsurfaceProfiles`) with visibility of their average roughness; rectangle's = fitted lobe at
each roughness, mixed (`profileRectLight`). From a light that transmits (`SceneLight.transmission`,
on a movable shadow-casting light: bit 16 of kind word, `transmitsLight`) it takes a transmission
term (`profileTransmission`, `PROFILE_TRANSMISSION_WGSL`): profile transmission samples
(`PROFILE_COLUMNS.transmissionProfile`, 32 over 5 cm, blended by two nearest) at optical depth
`(1 - shade) * 5` cm, × Henyey-Greenstein phase of profile scattering distribution at cosine of
light's opposite with view refracted into surface by profile inverse index of refraction. Term
weighed by light shadow and diffuse share like diffuse light, joins light scattering spreads
(`scatterAdd`). Texel and samples in light buffer after dual specular, `LIT_TRANSMISSION_VEC4S`
`vec4` per profile (`LIGHT_BUFFER_AT.transmissions`, `litTransmissionRows`).

Where scattering runs (`MODEL_SWITCH.subsurfaceScattering`), profile and eye pixels are lit with base
colour one, surface colour multiplied back after scattering, or with checkerboard (`sssLitBase`,
`sssLitSpecular`), and every light adds its diffuse luminance to lit image alpha (`scatterAdd`,
`lightOut`; `ADDITIVE_LIGHT`; first pass writes alpha 0 for such a pixel); indirect pass adds its
diffuse light's. Profiles are collected as declared (`subsurfaceProfileRow`, `registry.ts`) and
handed to each view (`setSubsurfaceProfiles`).
