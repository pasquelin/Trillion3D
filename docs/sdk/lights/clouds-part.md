# Clouds part

The `clouds` part is one ray marched cloud layer: in the view, in its shadow maps and in the sky
light's capture, with or without an atmosphere. `true` is the level's layer; an object sets fields
of the layer and its material over the defaults of the [parts table](sky-module.md#sky-module).
Drawn while the sky quality's `cloudsOn` is on (default), read each image. Wind drifts the clouds by
the world's time (a paused world holds them still). Under an orthographic camera the layer is
traced directly, a ray per pixel.

**Clouds with no atmosphere.** They stand on a planet of `planetRadiusKm` (6360) under the plane
`y = 0`: the sun and second light's illuminance reaches them (transmittance one), no haze,
`sunTintPerSample` has no effect, and `cloudDistantSkyLight` is the sky light's diffuse light. The
air's lights are packed for the clouds only while a clouds part is followed.

```js
world.scene.sky = { atmosphere: false, clouds: true, sun: true } // clouds over a planet with no air
```

**How the lights shade the cloud.** `rayMarchVolumeShadow` (default `true`) sets how the air's
lights shade the cloud, in the view and in the sky light's capture. On, a ray is marched through
the material from each sample toward each light (`shadowSamplesScale`, `shadowRayLengthKm`): exact,
dearer. Off, each sample reads the light's clouds' shadow map (sky quality `cloudShadowMap`, light's
`castCloudShadows` and `cloudShadowStrength`), optical depth `d` lets `exp(-d)` of the light through
for the first scattering order and `exp(-d · e^n)` for order `n`, `e` being `multiScatterOcclusion`.
A light with no map shades nothing. Changing the choice recompiles the programs once. The shadow map
also serves, in both settings: the air's march (sky, haze, distant sky light), surfaces' direct
light, fog's light and translucent surfaces; with the switch on the cloud does not read the map.

```js
// Cheaper clouds: read the shadow map instead of marching toward the sun.
world.modules.set('sky', { clouds: { rayMarchVolumeShadow: false } })
// The shadow map is then what shades the clouds, so keep it on and give the sun a map:
world.skyQuality = { cloudShadowMap: true }
```

**The sky light on the underside.** `undersideSkyLoss` (0.5, 0 to 1): share of the distant sky
light a cloud's underside loses where its material gives no occlusion. The built-in material gives
one (`ambientOcclusion`, 0.5), so it ignores the setting.

**The sun's shadow in the opaque scene.** `skyLightShadowFromOpaque` (off) acts on the capture's
clouds as well as its sky: the clouds read the sun's shadow map where `cloudSampleLightShadowMap`
is on and the air's first light casts a shadow projected this image.

**The sky meshes of the capture.** `skyLightDepthBuffer` (on) gives the real-time capture's faces
a depth buffer where they show the scene's sky meshes (sky-material surfaces): meshes cover each
other by distance, and height fog is laid at the distance of the mesh drawn there, an endless ray
only where none is. Off, meshes paint in sort order and fog is laid along an endless ray.

```js
// Fog at the true distance of the sky dome in the sky light's capture (the default); off lays it along an endless ray.
world.skyQuality = { skyLightDepthBuffer: false }
```

**The settings.** `cloudShadowMapSpatialFiltering` (1, 0 to 4), `cloudShadowMapNewFrameWeight` (1,
0 to 1), `cloudLocalLightShadowSamples` (12, 0 to 128), `cloudRenderTargetScale` (1, 0.1 to 1) and
`cloudEmptySpaceSkippingDepthKm` (40, from 1) take any number, held to the range when read: 8
filter passes is 4, a weight of 2 is 1. The sky occlusion map's settings (`cloudSkyAO`,
`cloudSkyAOResolutionMax`, `cloudSkyAOTraceSamples`, `cloudSkyAOFiltering`, `cloudSkyAOSnapKm`) are
in [the sky module](sky-module.md#sky-module). Removed (nothing reads them): `lightShaftAfterDof`,
and the sky light's `indirectLightingIntensity`, `samplesPerPixel`, `affectReflection` and
`affectGlobalIllumination` (reference reads them in ray-traced and path-traced lighting only). A
scene or call naming one is refused with the field's name.

**The empty-space table.** `cloudEmptySpaceSkipping` (off) builds before each view's tracing a table
of where the clouds start (32 × 32 texels over the view, `cloudEmptySpaceSkippingDepthKm` deep in
64 slices); a ray's march begins there; never in a reflection. `cloudEmptySpaceSkippingSliceBias`
(0) moves the start by that many slices (−1 one slice toward the eye);
`cloudEmptySpaceSkippingCorners` (on) reads each cell's corners as well as its centre. The built-in
material leaves the table's input unconnected (matter everywhere), so its table holds only the first
slice's start moved by the bias: the image is the one without the table, for the pass's cost.

```js
world.skyQuality = { cloudEmptySpaceSkipping: true } // the table is built each image
world.skyQuality = { cloudEmptySpaceSkippingSliceBias: 2, cloudEmptySpaceSkippingCorners: false }
world.skyQuality = { cloudEmptySpaceSkipping: null } // given back to the preset
```

**The cloud debug views.** `cloudDebugView` (`'none'`) replaces the clouds by a view of their
tracing, drawn over the lit image after the translucent surfaces: no cloud composition, translucent
surfaces read no cloud, no fog on the view. `'conservativeDensity'`: red is one minus the share of
each ray's samples where the material's conservative density is zero (a ray that meets nothing is
black); `'emptySpaceSkipping'`: the same share for the material's empty-space output, and green is
the distance the table starts the ray at over the table's depth (`cloudEmptySpaceSkippingDepthKm`),
so it needs `cloudEmptySpaceSkipping` on. Other channels hold the clouds' light; rays are marched
sample by sample (no start moved, no sample skipped). The second sun, lamps, sun's opaque shadow and
sun's colour per sample do not light the view.

```js
world.skyQuality = { cloudDebugView: 'conservativeDensity' } // see where the density bound is zero
world.skyQuality = { cloudEmptySpaceSkipping: true, cloudDebugView: 'emptySpaceSkipping' }
world.skyQuality = { cloudDebugView: null } // given back to the preset: the clouds are drawn again
```

**On the translucent surfaces.** Clouds are composed over the lit image before transparents are
drawn, so a translucent surface behind a cloud would be drawn over it. Two options fix this, both
read per vertex:

- `cloudShadowOnTranslucent` (project switch, `false`, read once at session open): the clouds'
  shadow maps also shade translucent surfaces. The forward directional light's shade is read from
  its clouds' shadow map at each vertex and interpolated. It applies where the forward light is one
  of the air's two lights with a map this image: sky quality `cloudShadowMap` on (default), light's
  `castCloudShadows` on (off by default) and its `cloudShadowOnSurfaceStrength` above 0 (1; factor
  on how much shade surfaces take). Advertised to tools by `runtimeToolsSchema` (field
  `cloudShadowOnTranslucent`, "effects" quality group, no preset writes it), held in the sky quality
  rules.
- `cloudFog` (material option, `false`): a `transparent` surface that is fogged (`fog` not `false`)
  receives the clouds in front of it as part of its fog: the cloud image is laid over each vertex's
  fog, faded in over `cloudSoftBlendingDistanceOnTranslucent` km from the cloud's front. A rough
  approximation (window behind a cloud bank, sprite beyond a cloud); a very large triangle shows
  the cloud at its corners only. Setting it on a scene material changes its blended programs, like
  `allowNegativeEmissive` changes the graph's.

`cloudFogLateOnTranslucent` (off), with `cloudFogLate` on and a trace size that rebuilds the image
(`'quarterToHalf'`, `'quarterToFull'`): surfaces whose material has `cloudFog` read the cloud image
with fog already laid on it, written by the rebuild as one more image of the rebuilt size; off, they
read it without the fog, so a translucent surface behind a cloud can show another fog than the
cloud's. `cloudSoftBlendingDistanceOnTranslucent` (0.5), from 0.0001, is the km from the cloud's
front over which the cloud fades in over a translucent surface behind it. With both off, translucent
programs hold none of this code; with either on, they read both per vertex, the off one giving its
neutral value.

```js
const world = createWorld('viewer', { cloudShadowOnTranslucent: true }) // the shade: a project switch
// The sun has a cloud shadow map, and lets the surfaces take all of its shade:
world.scene.sky = { clouds: true, sun: { castCloudShadows: true, cloudShadowOnSurfaceStrength: 1 } }
// A glass pane in the scene now darkens under a cloud's shadow; at 0.5 it would take half of it:
world.scene.sky = {
  clouds: true,
  sun: { castCloudShadows: true, cloudShadowOnSurfaceStrength: 0.5 },
}

const glass = material.meshStandard({
  transparent: true,
  opacity: 0.4,
  cloudFog: true, // the clouds in front of the glass are laid over its fog
})
world.skyQuality = {
  cloudFogLateOnTranslucent: true, // the image the translucent surfaces read has the fog on it
  cloudSoftBlendingDistanceOnTranslucent: 1, // 1 km to fade a cloud in over a surface behind it
}
world.skyQuality = { cloudFogLateOnTranslucent: null } // given back to the preset
```

The model: [the clouds in the air and the sky light](../../engine/atmosphere-and-sky-light.md#atmosphere-and-sky-light)
and [the transparent surfaces](../../engine/transparent-surfaces.md#transparent-surfaces).
