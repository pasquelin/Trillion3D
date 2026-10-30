# Shading models

**The shading model per pixel** (`materials/graph/outputsOf.ts`, `visibility/shader/shadeGraphWgsl.ts`,
`GRAPH_SHADING_MODELS`). Where the material says `fromMaterialExpression` (`VisMaterial.modelFromGraph`,
`isCompiled`: under any other name the output is not compiled) and an opaque or masked lit surface's
graph wires `shadingModel`, its resolve program computes `mgModel` (output rounded, the reference's
numbering) after the other outputs. An unlit pixel shows its emission (`rgb` the emission, no
emissive, metalness or occlusion) and leaves the surface flags unlit. The thin transmission
(`subsurfaceColor`) is kept only for `subsurface` and `twoSidedFoliage`; the clear coat only for
`clearCoat`; the cloth lobe (`cloth`, fuzz colour `subsurfaceColor`) only for `cloth`, in the lobe
record the graph writes (`physicalRecord.sheen`, packed by `clothTexel`). A graph wiring `cloth` and
no model keeps the cloth on and no thin transmission (`subsurfaceColor` being the fuzz colour). The
transparent pass reads none of them.

**The shading model of a material without a graph** (`visibility/shader/materialModelWgsl.ts`,
`MaterialParameters.shadingModel`). The record's model word holds a code (bits 29-31: skin, profile,
eye, hair, unlit, thin subsurface, toon), the profile (bits 20-27) and the subsurface opacity byte (an
eye's is one minus its iris mask); the record carries an eye's iris distance (`irisDistance`, one more
word: the record is eleven texels). The resolve sets the pixel model and the thin target as the
graph's per-pixel model does; a hair takes the page's tangent in the normal's place (the tangent is
decoded for it), an unlit pixel its emission alone.

**The GGX energy table and the preintegrated environment BRDF** (`sdk-core/src/lighting/shadingEnergy.ts`,
`lighting/direct/energyTermsWgsl.ts`; `sdk-core/src/lighting/environmentBrdf.ts`,
`lighting/direct/environmentBrdfWgsl.ts`). What a surface keeps of the light from every direction the
environment gives (probes', screen's, trace's, ambient cubemap's, the coat's own share:
`reflectionWeight`, `coatLayerKeep`) is `energyTerms`: `W · (f0 · E + (f90 − f0) · Ef)` read at
(N·V, perceptual roughness) from a 32 × 32 table of two 16-bit values (`E` the lobe's albedo under a
Fresnel of one, `Ef` its share under the Fresnel's fifth power), `W = 1 + f0 · (1 − E) / E` restoring
the energy the lobe's single scattering misses. Each texel is the mean over 2^14 points of an
Owen-scrambled Sobol sequence (`math/src/sequence/owenSobol.ts`) of the weight of a half vector drawn
among the visible normals, held as data (`shadingEnergyTable.ts`, written by
`node packages/sdk-core/src/lighting/shadingEnergy.fixture.ts`), in the light buffer after the
environment BRDF (`LIGHT_BUFFER_AT.shadingEnergy`), read bilinear, clamped to the edge, as a texture
would be. The diffuse colour is not darkened by the lobe, nor are direct lights compensated: the
shading's energy conservation is off, as in a project whose material buffer is the blendable one.
`f90` is `clamp(50 · f0.g)` (`envBrdfF90`, the green channel's alone) for the opaque composite,
`clamp(50 · max f0)` (`slabF90`) for the slab's. Only the single-layer water's reflection is weighed
by the preintegrated environment BRDF, `f0 · A + f90 · B` from a 128 × 32 table (`A` under a Fresnel
of one, `B` under its fifth power, 128 stratified samples a texel, built once,
`LIGHT_BUFFER_AT.envBrdf`). The rectangles' fitted lobe (`ltcTable.ts`) keeps its own split-sum
(`rectLtc`).

**The preintegrated skin, the subsurface profile, the hair and the eye**
(`materials/surface/pixelModel.ts`, `lighting/direct/shadingModelWgsl.ts`, `surfaceModelTerms.ts`).
A pixel whose `mgModel` is 3, 5, 7 or 9 keeps the physical model in the low three bits of its surface
flags (classed, shadowed and reflected as one) and carries its number in bits 25 to 28
(`PIXEL_MODEL_SHIFT`); a pixel with a model is of the `single` tile class (`pixelTileClass`), so the
`simple` class's programs hold none of it. What a model reads beyond the surface's values is left in
the thin transmission's target, whose texel is written without the sheet's flag (`SUBSURFACE_FLAG`
marks a back-lit sheet, which a skin is not):
- skin: `subsurfaceColor` and `opacity`;
- subsurface profile: its number (the material's `subsurfaceProfile`, held in its record's model word,
  `subsurfaceProfileOfModel`) and `opacity` (a pixel at or under `SUBSURFACE_OPACITY_THRESHOLD`, 0.1,
  keeps the plain model);
- eye: profile number in `x`, one minus its iris mask in the opacity, its distance in the metalness,
  the octahedral iris direction in `y` and `z`; or, with `irisNormal` (`uni.irisNormal`, the
  `MODEL_SWITCH` bits of `view.views.w`), its iris normal and caustic normal as octahedral differences
  from the surface's, the caustic's first in the metalness and its second in the specular byte (the
  lobe is then held at 0.25).

The target is made when a surface's graph wires `shadingModel` (`writesSubsurfaceTarget`).
`litPixelStatements` reads the number and texel once (`setPixelModel`; it gives a hair's scatter
amount and an eye's iris distance back out of the metalness, which neither is). In the light term
(`declaredLightWgsl`) a model's term joins `transmitted` (`modelTransmission`):
- the skin reads the preintegrated table, the imported image `skinTable.bin`, held in the light buffer
  after the rectangles' lobe (`LIGHT_BUFFER_AT.skin`), written when a scene holds a graph with a
  shading model (`followSkinTable`);
- the hair gives its own BSDF alone (no diffuse, no specular), weighed by the light's specular share;
- the eye gives a diffuse of its own over a specular lobe whose grazing reflectance is one
  (`modelLobeSurface`; a sphere light moves its highlight's half vector without the Newton step,
  `sphereHalfCosines`).

The indirect light's diffuse colour passes through `modelDiffuse` beside the cloth's hook
(`clothDiffuse`): the skin adds its subsurface colour, the hair is its response to the environment. A
hair reflects nothing (`surfaceReflects`). The eye's iris values and the clear coat's bottom normal
are held as the reference's surface buffer holds them: `unorm8` steps of 1/255, the iris and caustic
normals' octahedral differences halved (`*0.5 + 128/255`), the coat's bottom-normal difference
quartered (`*0.25 + 128/255`, `clearCoatNormal`, `uni.clearCoatNormal`: the pixel's normal then the
coat's, `coatBase`, its base the decoded bottom normal; `MODEL_SWITCH.clearCoatNormal` moves the
coat's half vector without the Newton step, `sphereNoNewton`). The shadow of a skin, as of the thin
transmission, is the shadow maps' own with the light a subsurface receiver lets through
(`vsmSubsurfaceShadow`, `docs/SHADOWS.md`); a subsurface profile, hair or eye is read from any side
of the surface and not back-face culled (`vsmSubsurfaceModel`).

A subsurface-profile pixel takes the light term of `profileModelWgsl.ts` in place of the plain lobes:
the Burley diffuse (`profileBurley`) and a specular of two GGX lobes (`profileSpecular`, from the
profile's dual specular, held in the light buffer as a `vec4` a profile, `LIGHT_BUFFER_AT.profiles`,
`followSubsurfaceProfiles`) with the visibility of their average roughness; a rectangle's is the
fitted lobe at each roughness, mixed (`profileRectLight`). From a light that transmits
(`SceneLight.transmission`, on a movable light casting a shadow: bit 16 of its kind word,
`transmitsLight`) it takes a transmission term (`profileTransmission`, `PROFILE_TRANSMISSION_WGSL`):
the profile's transmission samples (`PROFILE_COLUMNS.transmissionProfile`, 32 of them over 5 cm,
blended by the two nearest) at the optical depth the light's shadow reads as, `(1 - shade) * 5` cm
(the shadow maps give a profile no distance of their own; its encoded optical thickness is the shadow
itself), times the Henyey-Greenstein phase of the profile's scattering distribution at the cosine of
the light's opposite with the view refracted into the surface by the profile's inverse index of
refraction. The term is weighed by the light's shadow and diffuse share like the diffuse light, and
joins the light the scattering spreads (`scatterAdd`). The texel and samples are in the light buffer
after the dual specular, `LIT_TRANSMISSION_VEC4S` `vec4` a profile (`LIGHT_BUFFER_AT.transmissions`,
`litTransmissionRows`).

Where the scattering runs (`MODEL_SWITCH.subsurfaceScattering`), profile and eye pixels are lit with
a base colour of one, the surface's colour multiplied back after the scattering, or with the
checkerboard (`sssLitBase`, `sssLitSpecular`), and every light adds the luminance of its diffuse light
to the lit image's alpha (`scatterAdd`, `lightOut`; the additive blend sums the alpha,
`ADDITIVE_LIGHT`; the first pass writes alpha 0 for such a pixel); the indirect pass adds its diffuse
light's. The materials' profiles are collected as declared (`subsurfaceProfileRow`, `registry.ts`)
and handed to each view (`setSubsurfaceProfiles`).

