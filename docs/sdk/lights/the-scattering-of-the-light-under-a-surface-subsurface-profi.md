# The scattering of the light under a surface (subsurface profile)

A surface whose material graph picks the subsurface-profile shading model (`shadingModel: 'subsurfaceProfile'`, or a graph's output 5 under `fromMaterialExpression`) lights as a plain one, then the
engine spreads its diffuse light over the neighbouring pixels of the lit image by the profile's scattering, and multiplies the
result by the surface's colour: skin, wax, marble. The light is spread in the image, after the lights, the indirect light and the
reflections and before the sky, the fog and the transparents; the specular light is not. A profile is a subsurface
profile asset (`SubsurfaceProfile`: the colour and mean free path the light travels, the world unit scale, the boundary colour
bleed, the dual specular and the transmission); a pixel keeps its profile's number in the table of profiles the engine holds (`setSubsurfaceProfiles`), the default
skin being profile 0; the material parameter that names a profile is `subsurfaceProfile` (below). By default a profile is scattered by importance sampling, a few
samples a pixel chosen for the pixel's variance and drawn from the profile's own distribution; a profile of `implementation:
'separable'` is scattered by two separable passes. Each setting has the default of the reference's fourth quality level.

The profile of a material is its `subsurfaceProfile` parameter: any of the fields of the reference's subsurface profile asset, the others being
the default skin's (`scatterRadius` 1.2, `subsurfaceColor`, `falloffColor`, `boundaryColorBleed`, `extinctionScale`, `scatteringDistribution` 0.93,
`normalScale` 0.08, `ior` 1.55, `roughness0` 0.75, `roughness1` 1.3, `lobeMix` 0.85, `surfaceAlbedo`, `meanFreePathColor`, `meanFreePathDistance`,
`worldUnitScale`, `transmissionTintColor`, `tint`, `distanceScale`, `burley`, `meanFreePath` and `implementation`). A material that names none is
scattered by the default skin; two that name the same profile share it (at most 255 profiles).

```js
// Skin: a profile of its own, scattered by the pass, with no graph. `subsurfaceOpacity` (above 0.1) is the share of the profile's
// radius the pixel scatters over.
const skin = material.meshPhysical({
  color: 0xcc8c73,
  roughness: 0.45,
  shadingModel: 'subsurfaceProfile',
  subsurfaceProfile: { scatterRadius: 1.2, lobeMix: 0.85, roughness0: 0.75, roughness1: 1.3 },
  subsurfaceOpacity: 1,
})
// A graph decides each pixel's model only under `shadingModel: 'fromMaterialExpression'`.
```

**The shading model of a material** (`shadingModel`, the reference's own names: `defaultLit` the default, `unlit`, `subsurface`,
`preintegratedSkin`, `clearCoat`, `subsurfaceProfile`, `twoSidedFoliage`, `hair`, `cloth`, `eye`, `singleLayerWater`,
`thinTranslucent`, `toon` (the model of `material.meshToon`, no graph picks it: see below), and `fromMaterialExpression`, the model the `shadingModel` output of the material's graph gives each pixel; under any
other name the graph's output is ignored, as the reference ignores it). With no graph, as material parameters: `unlit` shows `emissive`
(times `emissiveIntensity`, and its map) alone; `preintegratedSkin` is lit by `subsurfaceColor` and `subsurfaceOpacity`; `subsurfaceProfile` by
`subsurfaceProfile` and `subsurfaceOpacity`; `eye` by `irisMask` (the share that is iris, 1 by default), `irisDistance` (0.1 by default, the
caustic's concavity) and a profile, the iris looking along (0, 0, -1); `hair` by its fibre direction, the page's tangent (the surface's normal where
the mesh stores none), `metalness` as its scatter amount, and `roughness`. The clear coat and the cloth are their parameters (`clearcoat`,
`clearcoatRoughness`, `sheen`, `sheenColor`, `sheenRoughness`), the thin subsurface (`subsurface`, `twoSidedFoliage`) the `subsurfaceColor` of a
double-sided surface. `singleLayerWater` and `thinTranslucent` stay node-driven, as in the reference: their inputs are the water's and the thin
translucent's output nodes of the material's graph.

**The toon material** (`material.meshToon`, a standard surface of the toon shading model: `color`, `metalness`, `roughness`, `specularIntensity`,
`emissive`, the normal map and `anisotropy` are read as a standard surface's) lights its pixels in bands: the diffuse light goes through the ramp of
its `toonProfile` at the cosine of the normal with the light, remapped from [-1, 1] to [0, 1], and the specular lobe, divided by its peak, through
the specular ramp. The profile (`toonProfile`, any of its fields, the others the default profile's; none: the default profile) holds `diffuseRamp`
and `specularRamp` (lists of `[time, value]` keys, a value a grey or `[r, g, b]`, linear between keys: the defaults are four diffuse bands at 0, 0.25,
0.5 and 0.75 and a hard specular at the lobe's middle), `diffuseRampOffsetTexture` / `diffuseRampOffsetStrength` (0) / `diffuseRampOffsetSize` (1) and
the same three for the specular (an image whose grey level, remapped to [-1, 1], moves the ramp's input over the surface, repeated `size` times
over the fraction of the mesh's first texture coordinates), `shadowHatchingPatternTexture` (an image whose
red, green, blue and alpha channels draw the shadow from light to dark), `shadowHatchingPatternDistributionRamp` (the shadow in, the weight out, a
list of `[time, value]` keys; the default is the identity), `shadowHatchingPatternSize` (1) and `shadowHatchingPatternStrength` (1),
`shadowExtinctionCoefficient` (10, per metre, 0 to 100: how deep light goes into the surface for the shadow maps — the light that survives an occluder distance
of `d` centimetres is `exp(-d * shadowExtinctionCoefficient / 100)`, a value of 1 leaving 36% after a metre), `diffuseIndirectScale` (1),
`specularIndirectScale` (1, the scale of the reflections), `specularIndirectRamp` (the keys `[time, value]` of the ramp that quantises the reflections; the default is the identity) with
`specularIndirectRampRepetition` (0: no quantisation; above 0, how many times the ramp repeats over the range of the reflections' luminance, once the setting
`toonReflectionQuantization` of `world.shading` is on) and `diffuseRampIncludesShadow` (`false`: the shadow multiplies the banded diffuse; `true`: it multiplies the ramp's
input). The offset and hatching images repeat over ten times the fraction of the mesh's first texture coordinates (the repetition the sizes multiply). A profile
is held while a material wears it and its row is free again when the material is disposed or declared with another profile: up to 255 distinct profiles at once, 16 of which may wear images.

```js
const toon = material.meshToon({
  color: 0xe0a060,
  roughness: 0.5,
  toonProfile: {
    // Three bands and a bright rim of specular, the middle band tinted.
    diffuseRamp: [[0, 0.1], [0.4, 0.1], [0.41, [0.9, 0.6, 0.5]], [0.7, [0.9, 0.6, 0.5]], [0.71, 1], [1, 1]],
    specularRamp: [[0, 0], [0.8, 0], [0.81, 1], [1, 1]],
    diffuseRampOffsetTexture: halftone, // a Texture whose grey level offsets the bands over the surface
    diffuseRampOffsetStrength: 0.15,
    diffuseRampOffsetSize: 8,
  },
})
```

| Setting | Meaning | Default |
| --- | --- | --- |
| `subsurfaceScattering` | The master switch; off, such a surface is lit as a plain one | `true` |
| `subsurfaceScale` | A scale on every profile's radius; 0 is off, below 1 narrower, above 1 wider | `1` |
| `subsurfaceHalfResolution` | Scatter at half the image's size: faster, of lower quality | `false` |
| `subsurfaceHalfResolutionSeparable` | In half resolution, scatter every profile with the separable passes | `true` |
| `subsurfaceRecombineQuality` | How the lit image is rebuilt and recombined: 0 low, 1 high, -1 automatic (high); an accumulated image is always high | `1` |
| `subsurfaceFilter` | The scattered image is read with the bilinear filter (off: the nearest texel) | `true` |
| `subsurfaceSampleSet` | The separable passes' samples a side: 0 is 6, 1 is 9, 2 is 13 | `2` |
| `subsurfaceCheckerboard` | 0: the lit image's alpha holds the diffuse light's luminance; 1: a checkerboard of diffuse and specular; 2: automatic (0) | `2` |
| `subsurfaceCheckerboardNeighborValidation` | With the checkerboard, a neighbour that is not a profile pixel adds nothing to the reconstruction | `false` |
| `subsurfaceBurleyQuality` | 0 scatters every profile with the separable passes; 1 the sampled scattering, the separable ones in half resolution | `1` |
| `subsurfaceBurleySamples` | A fixed count of samples a pixel for the sampled scattering; 0 lets the pixel's variance choose it | `0` |
| `subsurfaceBurleyProfileIdCache` | Each pixel's profile kept in a texture the passes read in place of the surfaces (a byte a pixel) | `true` |
| `subsurfaceBurleyBilateralKernel` | A sample weighs by depth alone (0) or depth and normal (1) | `1` |
| `subsurfaceBurleyMipsMinTileCount` | The count of tiles of sampled scattering from which the diffuse light's mip chain is made; 0 always | `4000` |
| `subsurfaceSubpixelThreshold` | The share of the scattering inside the pixel's own footprint above which a tile is not scattered | `1` |
| `subsurfaceSamplingChannel` | The channel that steers the sampled scattering: 0 the largest diffuse mean free path, 1 the largest mean free path | `1` |
| `subsurfaceColorTransmittanceDistance` | The distance (0.05 to 1) at which a `subsurface` material's colour is read as the light's transmittance (its hue shift) | `0.15` |

The quality presets write the scale, the separable samples, the recombine's quality and the half resolution: `smooth` a scale
of 0, `balanced` 0.75, both with the lowest sample set, the low recombine and the half resolution; `fine` the scale 1, the
medium sample set, the automatic recombine and the half resolution; `cinematic` the defaults at the full resolution; `max`
writes nothing. A view pays its textures only while a resident surface may carry the model: at full resolution about 40 bytes a
pixel (the setup texture with its mips, two scattering targets, the history pair, the recombined image and the profile ids).

```js
const world = createWorld('viewer', { subsurfaceScale: 0.5 }) // a narrower scattering
world.subsurfaceScattering = { subsurfaceHalfResolution: true } // from the next frame, at half the size
world.subsurfaceScattering = { subsurfaceBurleySamples: 32 } // a fixed 32 samples a pixel
world.subsurfaceScattering = { subsurfaceColorTransmittanceDistance: 0.3 } // the `subsurface` model's hue shift, weaker
world.subsurfaceScattering = { subsurfaceScale: null } // given back to the preset
world.subsurfaceScattering = { subsurfaceScattering: false } // off: no pass, no texture, no byte
```

The explorer takes the same by field (`explorer.setSubsurfaceScattering('subsurfaceScale', 2)`), and an agent through
`trillion3d_set_subsurface_scattering`.
