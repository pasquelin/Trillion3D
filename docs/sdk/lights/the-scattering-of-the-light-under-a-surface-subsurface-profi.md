# The scattering of the light under a surface (subsurface profile)

A surface with the subsurface-profile shading model (`shadingModel: 'subsurfaceProfile'`, or a
graph's output 5 under `fromMaterialExpression`) is lit as a plain one; the engine then spreads its
diffuse light over neighbouring pixels by the profile's scattering and multiplies by the surface's
colour. Runs after lights, indirect light and reflections, before sky, fog and transparents;
specular is not spread. A profile is a `SubsurfaceProfile` asset held in a table
(`setSubsurfaceProfiles`), default skin being profile 0; the material parameter is
`subsurfaceProfile`. Default scattering is importance sampling; `implementation: 'separable'` uses
two separable passes. Defaults are the reference's fourth quality level.

`subsurfaceProfile` takes any field of the reference's asset, the others the default skin's
(`scatterRadius` 1.2, `subsurfaceColor`, `falloffColor`, `boundaryColorBleed`, `extinctionScale`,
`scatteringDistribution` 0.93, `normalScale` 0.08, `ior` 1.55, `roughness0` 0.75, `roughness1` 1.3,
`lobeMix` 0.85, `surfaceAlbedo`, `meanFreePathColor`, `meanFreePathDistance`, `worldUnitScale`,
`transmissionTintColor`, `tint`, `distanceScale`, `burley`, `meanFreePath`, `implementation`). No
profile: default skin; same profile shared (at most 255).

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

**The shading model of a material** (`shadingModel`, reference names: `defaultLit` the default,
`unlit`, `subsurface`, `preintegratedSkin`, `clearCoat`, `subsurfaceProfile`, `twoSidedFoliage`,
`hair`, `cloth`, `eye`, `singleLayerWater`, `thinTranslucent`, `toon` (`material.meshToon`; no
graph picks it) and `fromMaterialExpression`, the model the graph's `shadingModel` output gives
each pixel; under any other name that output is ignored). With no graph, as material parameters:

- `unlit` shows `emissive` (times `emissiveIntensity`, and its map) alone;
- `preintegratedSkin`: `subsurfaceColor` and `subsurfaceOpacity`;
- `subsurfaceProfile`: `subsurfaceProfile` and `subsurfaceOpacity`;
- `eye`: `irisMask` (share that is iris, 1), `irisDistance` (0.1, caustic's concavity) and a
  profile; the iris looks along (0, 0, -1);
- `hair`: fibre direction is the page's tangent (the normal where the mesh stores none),
  `metalness` is the scatter amount, and `roughness`;
- clear coat and cloth: `clearcoat`, `clearcoatRoughness`, `sheen`, `sheenColor`, `sheenRoughness`;
  thin subsurface (`subsurface`, `twoSidedFoliage`): `subsurfaceColor` of a double-sided surface;
- `singleLayerWater` and `thinTranslucent` stay node-driven: their inputs are the graph's water and
  thin translucent output nodes.

**The toon material** (`material.meshToon`; `color`, `metalness`, `roughness`,
`specularIntensity`, `emissive`, normal map, `anisotropy` as standard) lights in bands: diffuse goes
through the ramp at the normal-light cosine remapped to [0, 1]; the specular lobe, divided by its
peak, through the specular ramp. `toonProfile` takes any field below, others default:

- `diffuseRamp` and `specularRamp`: lists of `[time, value]` keys (value a grey or `[r, g, b]`),
  linear between keys; defaults four diffuse bands at 0, 0.25, 0.5, 0.75 and a hard specular at the
  lobe's middle;
- `diffuseRampOffsetTexture` / `diffuseRampOffsetStrength` (0) / `diffuseRampOffsetSize` (1), and
  the same three for the specular: grey level remapped to [-1, 1] moves the ramp's input, repeated
  `size` times over ten times the first texture coordinates' fraction;
- `shadowHatchingPatternTexture`: red, green, blue, alpha channels draw the shadow from light to
  dark; `shadowHatchingPatternDistributionRamp` (`[time, value]` keys; default identity),
  `shadowHatchingPatternSize` (1), `shadowHatchingPatternStrength` (1);
- `shadowExtinctionCoefficient` (10 per metre, 0 to 100): light surviving an occluder distance of
  `d` centimetres is `exp(-d * shadowExtinctionCoefficient / 100)`;
- `diffuseIndirectScale` (1), `specularIndirectScale` (1), `specularIndirectRamp` (`[time, value]`
  keys; default identity) with `specularIndirectRampRepetition` (0: none; above 0, repeats over the
  reflections' luminance range, once `toonReflectionQuantization` of `world.shading` is on);
- `diffuseRampIncludesShadow` (`false`: shadow multiplies the banded diffuse; `true`: the ramp's
  input).

Up to 255 distinct profiles at once, 16 of which may wear images; one is freed when its material
is disposed or declared with another.

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
| - | - | - |
| `subsurfaceScattering` | Master switch; off, lit as a plain surface | `true` |
| `subsurfaceScale` | Scale on every profile's radius; 0 off | `1` |
| `subsurfaceHalfResolution` | Scatter at half size | `false` |
| `subsurfaceHalfResolutionSeparable` | In half resolution, every profile uses the separable passes | `true` |
| `subsurfaceRecombineQuality` | 0 low, 1 high, -1 automatic (high); an accumulated image is always high | `1` |
| `subsurfaceFilter` | Bilinear read of the scattered image (off: nearest) | `true` |
| `subsurfaceSampleSet` | Separable samples a side: 0 is 6, 1 is 9, 2 is 13 | `2` |
| `subsurfaceCheckerboard` | 0: lit image's alpha holds diffuse luminance; 1: checkerboard of diffuse and specular; 2: automatic (0) | `2` |
| `subsurfaceCheckerboardNeighborValidation` | With checkerboard, a non-profile neighbour adds nothing to the reconstruction | `false` |
| `subsurfaceBurleyQuality` | 0: every profile separable; 1: sampled scattering, separable in half resolution | `1` |
| `subsurfaceBurleySamples` | Fixed samples a pixel for sampled scattering; 0: pixel variance chooses | `0` |
| `subsurfaceBurleyProfileIdCache` | Profile per pixel kept in a texture (a byte a pixel) | `true` |
| `subsurfaceBurleyBilateralKernel` | Sample weight by depth (0) or depth and normal (1) | `1` |
| `subsurfaceBurleyMipsMinTileCount` | Sampled-scattering tile count from which the diffuse mip chain is made; 0 always | `4000` |
| `subsurfaceSubpixelThreshold` | Scattering share inside the pixel's footprint above which a tile is not scattered | `1` |
| `subsurfaceSamplingChannel` | Steers sampled scattering: 0 largest diffuse mean free path, 1 largest mean free path | `1` |
| `subsurfaceColorTransmittanceDistance` | Distance (0.05 to 1) at which a `subsurface` material's colour is read as transmittance (hue shift) | `0.15` |

Presets write scale, sample set, recombine quality, half resolution: `smooth` scale 0, `balanced`
0.75, both lowest sample set, low recombine, half resolution; `fine` scale 1, medium sample set,
automatic recombine, half resolution; `cinematic` defaults at full resolution; `max` nothing.
Textures exist only while a resident surface may carry the model: about 40 bytes a pixel at full
resolution.

```js
const world = createWorld('viewer', { subsurfaceScale: 0.5 }) // a narrower scattering
world.subsurfaceScattering = { subsurfaceHalfResolution: true } // from the next frame, at half the size
world.subsurfaceScattering = { subsurfaceBurleySamples: 32 } // a fixed 32 samples a pixel
world.subsurfaceScattering = { subsurfaceColorTransmittanceDistance: 0.3 } // the `subsurface` model's hue shift, weaker
world.subsurfaceScattering = { subsurfaceScale: null } // given back to the preset
world.subsurfaceScattering = { subsurfaceScattering: false } // off: no pass, no texture, no byte
```

Explorer: `explorer.setSubsurfaceScattering('subsurfaceScale', 2)`; agent:
`trillion3d_set_subsurface_scattering`.
