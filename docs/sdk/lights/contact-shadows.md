# Contact shadows

A shadow map is too coarse for what stands against a surface, so the lit passes add a **contact
shadow**: a short ray (eight steps) from each pixel toward each light through the scene's depth, which
darkens the pixel where something touches it in the light's way. Each light names its own, as
properties (also parameters of the light tool and fields of a saved scene), every kind of light's:

| Light property | Default | Meaning |
| --- | --- | --- |
| `contactShadowLength` | `0` | ray length; `0` casts none. Screen units (a share of the screen's height at the pixel's depth) unless the next. Only a light that casts a shadow (`castShadow`) casts one, and only while the shadow quality is above 0 (below it no light has the dynamic shadow bit; the hair model's short ray stays) |
| `contactShadowLengthInWorldSpace` | `false` | the length is in metres |
| `contactShadowCastingIntensity` | `1` | how dark the shadow is, 0 to 1, where the ray meets a surface that casts contact shadows (every surface but an eye's and one of an object with `castContactShadow = false`) |
| `contactShadowNonCastingIntensity` | `0` | how dark it is, 0 to 1, where it meets one that does not |

The eye and hair shading models cast a ray whatever the light and the view's switch say: an eye pixel
half a centimetre toward every light; a hair pixel a fifth of the half height of the screen at its
depth under a light that casts no shadow. The view's settings are shadow settings, also options of
`createWorld`; no quality level writes them:

| View option | Default | Meaning |
| --- | --- | --- |
| `contactShadows` | `true` | whether the lights cast their rays; off, they cast none (the eye and hair models still cast theirs, and so do the surfaces of a material with `contactShadows`) |
| `contactShadowOverrideLength` | `-1` | length replacing every light's own when 0 or more (`0` turns the lights' off); below 0, none |
| `contactShadowOverrideLengthInWorldSpace` | `false` | whether that length is in metres |
| `contactShadowOverrideCastingIntensity` | `-1` | intensity of every light's shadow at a surface that casts, when 0 or more (any number; the effective intensity is held to 1, above which the reference lights negatively) |
| `contactShadowOverrideNonCastingIntensity` | `-1` | the same at a surface that does not |
| `contactShadowMethod` | `0` | how the lights' rays are cast: `0` the short ray every lit pixel casts, `1` the Bend screen-space shadow, a texture made before the lighting |
| `contactShadowBendSurfaceThickness` | `0.005` | thickness a pixel's surface is taken to have when a Bend ray meets it (share of the depth left to the far plane); method `1` only |
| `contactShadowBendMaxLights` | `8` | lights the Bend march serves in an image (1 to 16), suns first then the nearest local lights; the others cast the short ray; one texture of the image's size (4 bytes a pixel) each |
| `contactShadowIntensityMode` | `0` | the Bend shadow's intensity: `0` by the hit surface's `castContactShadow`, `1` by depth (fade below), `2` the casting intensity everywhere |
| `contactShadowIntensityFadeStart` | `1600` | depth in centimetres where the Bend shadow begins to fade from the non-casting to the casting intensity (mode `1`) |
| `contactShadowIntensityFadeLength` | `800` | length of that fade, in centimetres (mode `1`) |

```js
// A lamp whose shadow holds the books down on the shelf: a ray of a fiftieth of the screen's height, on a light that casts.
const lamp = light.point({ intensity: 20, position: [0, 3, 0], distance: 12, castShadow: true })
lamp.contactShadowLength = 0.02
// A sun with its ray in metres, and a shadow half as dark.
const sun = light.directional({
  castShadow: true,
  contactShadowLength: 0.3,
  contactShadowLengthInWorldSpace: true,
  contactShadowCastingIntensity: 0.5,
})
// The view: every light's ray at four hundredths of the screen's height, then back to the lights' own; or none at all.
const world = createWorld('viewer', { contactShadowOverrideLength: 0.04 })
world.shadows = { contactShadowOverrideLength: null }
world.shadows = { contactShadows: false }
```

**Ray-traced shadows.** A light's shadow found by casting rays from each pixel to a point of the light
through the scene's triangles, instead of reading the shadow maps. They need the scene's triangles (the
ray-tracing file); without them the options below are accepted and every light keeps its shadow maps.
View options (shadow settings, also options of `createWorld`; no quality level writes them):

| View option | Default | Meaning |
| --- | --- | --- |
| `rayTracedShadows` | `false` | the lights that follow the view (`castRayTracedShadow: 'useProjectSetting'`, a light's default) cast by rays |
| `rayTracedShadowsDirectionalLights` / `PointLights` / `SpotLights` / `RectLights` | `true` | which kinds of light may cast by rays at all |
| `rayTracedShadowsSamplesPerPixel` | `-1` | rays a pixel casts to each light; `-1` leaves it to the light's `rayTracedShadowSamplesPerPixel` (1) |
| `rayTracedShadowsNormalBias` | `0.1` | centimetres, at least 0.01: the most a ray's start moves along the normal |
| `rayTracedShadowsAvoidSelfIntersectionTraceDistance` | `1` | centimetres: the short first ray that leaves the pixel's own surface; `0` casts none |
| `rayTracedShadowsTwoSidedGeometry` | `true` | geometry casts from both faces |
| `rayTracedShadowsAcceptFirstHit` | `true` | a ray ends at the first primitive it meets |
| `rayTracedShadowsLODTransitionStart` / `LODTransitionEnd` | `4000` / `5000` | centimetres from the eye: a subsurface or hair pixel's shadow goes over from its occlusion to the light that gets through it, from the first distance to the second |
| `rayTracedShadowsDirectionalLightTraceDistance` | `10000` | centimetres (1000 to 1000000): how far from a pixel a directional light's ray goes back toward it to measure a subsurface or hair pixel's thickness (one value for the view's suns) |
| `rayTracedShadowsDenoiser` | `true` | a light with a size (a sun with an `angularRadius`, a lamp with an `emitterRadius`, a rectangle) has its ray-traced shadow denoised: penumbra found from the distance to the nearest blocker, reconstructed, pre-convolved and accumulated over the images |
| `rayTracedShadowsDenoiserReconstructionSamples` | `8` | most samples of the reconstruction (1 to 56) |
| `rayTracedShadowsDenoiserPreConvolution` | `1` | pre-convolution passes after the reconstruction (0 to 4) |
| `rayTracedShadowsDenoiserTemporalAccumulation` | `true` | the denoised shadow is accumulated over the images (a history a light) |
| `rayTracedShadowsDenoiserHistoryConvolutionSamples` | `1` | samples of the convolution of the accumulated history (1 to 56); `1` runs none |

Each light names its own, as properties (also parameters of the light tool and fields of a saved
scene), every kind of light's: `castRayTracedShadow` (`'useProjectSetting'`; `'disabled'` never,
`'enabled'` always) and `rayTracedShadowSamplesPerPixel` (`1`, from 1). The rays go to a point of the
light drawn by the solid angle it covers (a sun's disk, a lamp's sphere, a rectangle's face); the
lighting keeps the scene trace for them whatever the device's hardware.

```js
// One light always casts by rays, with four rays a pixel, whatever the view says.
const light = world.addLight({ kind: 'spot', castRayTracedShadow: 'enabled', rayTracedShadowSamplesPerPixel: 4 })
```

```js
// Every light casts its shadow by rays, two rays a pixel; the sun keeps its maps.
const world = await createWorld({ rayTracedShadows: true, rayTracedShadowsSamplesPerPixel: 2, rayTracedShadowsDirectionalLights: false })
```

The volumetric fog can take those rays too: with `volumetricFogInjectRaytracedLights` (`false` by
default, a setting of the volumetric fog, `world.volumetricFog…`) each cell casts, from its first
sample, one ray through the scene's triangles toward every light of the light buffer that casts by
rays and shadows the fog (`shadowsFog`), the sun included when it is the fog's directional light,
however many there are. The result is one bit a light in a volume of the grid's cells (a layer of the
volume's depth per 32 lights; a device whose 3D textures are too shallow for all layers leaves the
last lights to their maps). The sun's ray multiplies its other shadows (maps, clouds); a local light's
replaces its shadow map. The lighting keeps the scene trace for it.

```js
// The fog is shadowed by the rays of the lights that cast by rays.
const world = await createWorld({ rayTracedShadows: true, volumetricFogInjectRaytracedLights: true })
```

```js
// A sun with a disk, its ray-traced penumbra denoised with a wider pre-convolution and no history; then the raw rays.
const world = await createWorld({ rayTracedShadows: true, rayTracedShadowsDenoiserPreConvolution: 2, rayTracedShadowsDenoiserTemporalAccumulation: false })
world.shadows = { rayTracedShadowsDenoiser: false }
```

**Ray-traced sky light** (off by default): [its own page](../ray-traced-sky-light.md).

The rays honour a light's lighting channels and a tube's capsule (not its centre), and let the back faces
of surfaces that light goes through (an eye, a thin two-sided sheet, a subsurface-model pixel) be lit;
the shadow of a subsurface or hair pixel takes the light that gets through its thickness. The subsurface
profile's transmission keeps reading the shadow as its thickness.

Two more options say what the rays meet and what they shade, one of an object and one of a material:

- **`castContactShadow`** (boolean, `true`), a property of every object, saved with the world: whether
  the object stops the rays the lights cast from the pixels around it. `false` lets them through its
  pixels, which then count, where a ray meets them, as surfaces that do not cast
  (`contactShadowNonCastingIntensity`); the eye model never casts, whatever the object says. It changes
  nothing of the object's own pixels.
- **`contactShadows`** (boolean, `false`), an option of a material: the lights cast contact shadows on a
  see-through surface of it lit with `translucencyLighting: 'forward'` (an opaque one is shadowed by the
  lights' own rays), or a transmissive one. From each of its pixels a ray of a fifth of the half height
  of the screen at its depth goes toward every light through the opaque scene's depth, whatever the
  light's own length, its `castShadow` or the view's `contactShadows` say, with the light's casting and
  non-casting intensities. The translucent programs hold that code only for a scene with such a
  material. A single-layer water casts none; a surface lit from the translucency lighting volume has
  no light to cast one toward.

```js
// A figure that does not shade its neighbours' pixels with a contact shadow, and a pane that receives them.
statue.castContactShadow = false
const glass = material.meshStandard({
  transparent: true,
  opacity: 0.3,
  translucencyLighting: 'forward',
  contactShadows: true,
})
```

A light also holds `indirectLightingIntensity` (`1`, from 0): the factor on the light it gives the
scene's indirect lighting, kept in the same record. A light that casts no shadow gives the material's
occlusion to its lobes: a pixel in a crease of an ambient-occlusion map is darker under it, as under the
shadow of a light that casts one. How the ray is made, and how the view's settings reach the lights:
[ENGINE.md](../../engine/direct-lighting.md#direct-lighting).
