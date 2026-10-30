# Contact shadows

Lit passes add a **contact shadow**: a short ray (eight steps) per pixel toward each light through
scene depth. Light properties (also light-tool parameters and saved-scene fields), every kind:

| Light property | Default | Meaning |
| - | - | - |
| `contactShadowLength` | `0` | ray length; `0` none. Screen units (share of screen height at the pixel's depth) unless the next. Only a light with `castShadow`, while shadow quality is above 0 |
| `contactShadowLengthInWorldSpace` | `false` | length in metres |
| `contactShadowCastingIntensity` | `1` | darkness, 0 to 1, at a surface that casts contact shadows (all but eyes and objects with `castContactShadow = false`) |
| `contactShadowNonCastingIntensity` | `0` | darkness, 0 to 1, at one that does not |

Eye and hair models cast a ray whatever light and view say: eye pixel 0.5 cm toward every light; hair
pixel a fifth of screen half height under a light that casts no shadow. View settings are shadow
settings, also `createWorld` options; no quality level writes them:

| View option | Default | Meaning |
| - | - | - |
| `contactShadows` | `true` | lights cast their rays; off, none (eye, hair, `contactShadows` materials still cast) |
| `contactShadowOverrideLength` | `-1` | replaces every light's length when 0 or more (`0` turns off); below 0, none |
| `contactShadowOverrideLengthInWorldSpace` | `false` | that length in metres |
| `contactShadowOverrideCastingIntensity` | `-1` | every light's casting intensity when 0 or more (effective held to 1) |
| `contactShadowOverrideNonCastingIntensity` | `-1` | same, non-casting |
| `contactShadowMethod` | `0` | `0` short ray, `1` Bend screen-space shadow (texture made before lighting) |
| `contactShadowBendSurfaceThickness` | `0.005` | surface thickness at a Bend hit (share of depth to far plane); method `1` |
| `contactShadowBendMaxLights` | `8` | lights Bend serves per image (1 to 16), suns then nearest local; others cast the short ray; one image-size 4-byte texture each |
| `contactShadowIntensityMode` | `0` | Bend intensity: `0` by hit's `castContactShadow`, `1` by depth (fade below), `2` casting everywhere |
| `contactShadowIntensityFadeStart` | `1600` | cm depth where Bend fades non-casting to casting intensity (mode `1`) |
| `contactShadowIntensityFadeLength` | `800` | fade length, cm (mode `1`) |

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

**Ray-traced shadows.** Rays from each pixel to a point of the light through scene triangles replace
shadow maps. They need the scene's triangles (ray-tracing file); without them the options are
accepted and lights keep their maps. View options (shadow settings, also `createWorld` options; no
quality level writes them):

| View option | Default | Meaning |
| - | - | - |
| `rayTracedShadows` | `false` | lights following the view (`castRayTracedShadow: 'useProjectSetting'`) cast by rays |
| `rayTracedShadowsDirectionalLights` / `PointLights` / `SpotLights` / `RectLights` | `true` | kinds that may cast by rays |
| `rayTracedShadowsSamplesPerPixel` | `-1` | rays per pixel per light; `-1` defers to light's `rayTracedShadowSamplesPerPixel` (1) |
| `rayTracedShadowsNormalBias` | `0.1` | cm, at least 0.01: most a ray start moves along the normal |
| `rayTracedShadowsAvoidSelfIntersectionTraceDistance` | `1` | cm: short first ray leaving the pixel's surface; `0` none |
| `rayTracedShadowsTwoSidedGeometry` | `true` | geometry casts from both faces |
| `rayTracedShadowsAcceptFirstHit` | `true` | ray ends at first primitive met |
| `rayTracedShadowsLODTransitionStart` / `LODTransitionEnd` | `4000` / `5000` | cm from eye: subsurface/hair shadow goes from its occlusion to light getting through |
| `rayTracedShadowsDirectionalLightTraceDistance` | `10000` | cm (1000 to 1000000): directional ray length back toward a pixel to measure subsurface/hair thickness |
| `rayTracedShadowsDenoiser` | `true` | lights with size (sun `angularRadius`, lamp `emitterRadius`, rectangle) get a denoised shadow |
| `rayTracedShadowsDenoiserReconstructionSamples` | `8` | most reconstruction samples (1 to 56) |
| `rayTracedShadowsDenoiserPreConvolution` | `1` | pre-convolution passes (0 to 4) |
| `rayTracedShadowsDenoiserTemporalAccumulation` | `true` | accumulated over images (history per light) |
| `rayTracedShadowsDenoiserHistoryConvolutionSamples` | `1` | history convolution samples (1 to 56); `1` none |

Light properties (also tool parameters and saved-scene fields): `castRayTracedShadow`
(`'useProjectSetting'`; `'disabled'` never, `'enabled'` always) and `rayTracedShadowSamplesPerPixel`
(`1`, from 1). Rays go to a point drawn by the solid angle the light covers.

```js
// One light always casts by rays, with four rays a pixel, whatever the view says.
const light = world.addLight({ kind: 'spot', castRayTracedShadow: 'enabled', rayTracedShadowSamplesPerPixel: 4 })
```

```js
// Every light casts its shadow by rays, two rays a pixel; the sun keeps its maps.
const world = await createWorld({ rayTracedShadows: true, rayTracedShadowsSamplesPerPixel: 2, rayTracedShadowsDirectionalLights: false })
```

`volumetricFogInjectRaytracedLights` (`false`, `world.volumetricFog…`): each fog cell casts one ray
toward every light-buffer light that casts by rays and shadows the fog (`shadowsFog`), the sun when
it is the fog's directional light. One bit per light in a volume (a depth layer per 32 lights; a
device with too shallow 3D textures leaves the last lights to their maps). A sun's ray multiplies its
other shadows; a local light's replaces its map.

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

Rays honour lighting channels and a tube's capsule, and let back faces of surfaces light goes
through (eye, thin two-sided sheet, subsurface pixel) be lit; a subsurface or hair pixel's shadow
takes the light getting through its thickness.

- **`castContactShadow`** (boolean, `true`), object property saved with the world: `false` lets
  surrounding pixels' rays through; its pixels count as non-casting (`contactShadowNonCastingIntensity`);
  eyes never cast.
- **`contactShadows`** (boolean, `false`), material option: lights cast contact shadows on its
  see-through surface lit with `translucencyLighting: 'forward'` (opaque gets the lights' own rays), or
  transmissive: a ray of a fifth of screen half height toward every light through opaque depth,
  whatever light length, `castShadow` or view `contactShadows` say, with the light's intensities.
  Single-layer water casts none; a surface lit from the translucency lighting volume has no light
  to cast toward.

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

A light also holds `indirectLightingIntensity` (`1`, from 0): factor on its scene indirect lighting.
A light casting no shadow gives the material's occlusion to its lobes. See
[ENGINE.md](../../engine/direct-lighting.md#direct-lighting).
