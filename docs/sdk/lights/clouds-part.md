# Clouds part

The `clouds` part is one layer of clouds ray marched from the eye: in the view, in its shadow maps and in
the sky light's capture, whether or not the scene has an atmosphere. `true` is the level's layer; an
object sets fields of the layer and of its material over the defaults of the [parts table](sky-module.md#sky-module).
It is drawn while the sky quality's `cloudsOn` is on (the default), read again at each image. The wind
drifts the clouds by the world's time, the clock the material graphs read: a paused world holds them
still. Under an orthographic camera the layer is traced directly, a ray for each pixel.

**Clouds with no atmosphere.** With none they stand on a planet of `planetRadiusKm` (6360 by default)
under the plane `y = 0`: the sun and the second light's own illuminance reaches them (a transmittance of
one), there is no haze on them and `sunTintPerSample` has no effect, and the distant sky light that lights
them (`cloudDistantSkyLight`) is the sky light's own diffuse light, not read from an air. The lights of the
air are packed for the clouds only while a clouds part is followed.

```js
world.scene.sky = { atmosphere: false, clouds: true, sun: true } // clouds over a planet with no air
```

**How the lights shade the cloud.** `rayMarchVolumeShadow` (default `true`) says how the cloud is shaded
by the air's lights, in the view and in the sky light's capture. On, a ray is marched through the material
from each sample toward each light (`shadowSamplesScale`, `shadowRayLengthKm`): the exact shade, dearer.
Off, no ray is marched: each sample reads the clouds' shadow map of the light (the sky quality's
`cloudShadowMap`, the light's `castCloudShadows` and `cloudShadowStrength`), its optical depth `d` letting
`exp(-d)` of the light through for the first order of scattering and `exp(-d · e^n)` for the order `n`,
`e` being `multiScatterOcclusion`. A light with no map (the setting off, the light not casting cloud
shadows) then shades nothing. The programs are made for the choice, so changing it compiles them again
once. What the shadow map serves besides, in both settings: the air's march (the sky, the haze, the
distant sky light), the surfaces' direct light, the fog's light and the translucent surfaces; with the
switch on, the cloud's own shade is marched and the map is not read by the cloud.

```js
// Cheaper clouds: read the shadow map instead of marching toward the sun.
world.modules.set('sky', { clouds: { rayMarchVolumeShadow: false } })
// The shadow map is then what shades the clouds, so keep it on and give the sun a map:
world.skyQuality = { cloudShadowMap: true }
```

**The sky light on the underside.** `undersideSkyLoss` (0.5, from 0 to 1) is how much of the distant
sky light the underside of a cloud loses where the cloud's material gives no occlusion of its own. The
built-in material always gives one (`ambientOcclusion`, 0.5), so no cloud of it reads the setting.

**The sun's shadow in the opaque scene.** `skyLightShadowFromOpaque` (off) acts on the clouds of the sky
light's capture as well as on its sky: the clouds read the sun's shadow map where
`cloudSampleLightShadowMap` is on and the first light of the air casts a shadow that is projected this
image.

**The sky meshes of the capture.** `skyLightDepthBuffer` (on) gives the faces of the real-time capture a depth buffer
where they show the scene's sky meshes (the surfaces of a sky material): the meshes cover each other by their
distance, and the height fog is laid over each pixel at the distance of the mesh drawn there, an endless ray only
where no mesh is. Off, the meshes are painted in their sort order and the fog is laid along an endless ray.

```js
// Fog at the true distance of the sky dome in the sky light's capture (the default); off lays it along an endless ray.
world.skyQuality = { skyLightDepthBuffer: false }
```

**The settings.** `cloudShadowMapSpatialFiltering` (1, read from 0 to 4), `cloudShadowMapNewFrameWeight`
(1, read from 0 to 1), `cloudLocalLightShadowSamples` (12, read from 0 to 128), `cloudRenderTargetScale`
(1, read from 0.1 to 1) and `cloudEmptySpaceSkippingDepthKm` (40, read from 1) take any number and are
read held to the range, as the console variables they come from are: 8 filter passes is 4, a weight of 2
is 1. The sky occlusion map's settings (`cloudSkyAO`, `cloudSkyAOResolutionMax`, `cloudSkyAOTraceSamples`,
`cloudSkyAOFiltering`, `cloudSkyAOSnapKm`) are in [the sky module](sky-module.md#sky-module). Removed, because nothing in
the engine could read them: `lightShaftAfterDof` (the shafts are added to the lit image; the other image
the switch could send them to, a translucency drawn apart, does not exist here), and the sky
light's `indirectLightingIntensity`, `samplesPerPixel`, `affectReflection` and
`affectGlobalIllumination` (the reference reads them in its ray-traced and path-traced lighting only). A
scene or a call naming one is refused with the field's name.

**The empty-space table.** `cloudEmptySpaceSkipping` (off) builds, before each view's tracing, a table of
where the clouds start (32 × 32 texels over the view, `cloudEmptySpaceSkippingDepthKm` deep in 64 slices),
and the march of a ray begins there; never in a reflection. `cloudEmptySpaceSkippingSliceBias` (0) moves
the start by that many slices, −1 one slice toward the eye, and `cloudEmptySpaceSkippingCorners` (on)
reads the corners of each cell as well as its centre. The built-in material leaves the table's input
unconnected, and an unconnected input says matter is everywhere, so its table holds only the first
slice's start moved by the bias (0 by default): the image is the one without the table, for the cost of
the pass.

```js
world.skyQuality = { cloudEmptySpaceSkipping: true } // the table is built each image
world.skyQuality = { cloudEmptySpaceSkippingSliceBias: 2, cloudEmptySpaceSkippingCorners: false }
world.skyQuality = { cloudEmptySpaceSkipping: null } // given back to the preset
```

**The cloud debug views.** `cloudDebugView` (`'none'`) replaces the clouds by a view of their tracing,
drawn over the lit image after the translucent surfaces: the clouds' own composition is not drawn, the
translucent surfaces read no cloud, and the fog is not laid on the view. With `'conservativeDensity'` the
red channel is one minus the share of each ray's samples where the material's conservative density is
zero (a ray that meets nothing is black); with `'emptySpaceSkipping'` it is the same share for the
material's empty-space output, and the green channel is the distance the empty-space table starts the
ray at, over the table's depth (`cloudEmptySpaceSkippingDepthKm`), so it shows with `cloudEmptySpaceSkipping`
on. The other channels hold the clouds' light, and the rays are marched sample by sample: the table
moves no start and no sample is skipped. The second sun, the lamps, the sun's opaque shadow and the sun's colour per sample do not light the view.

```js
world.skyQuality = { cloudDebugView: 'conservativeDensity' } // see where the density bound is zero
world.skyQuality = { cloudEmptySpaceSkipping: true, cloudDebugView: 'emptySpaceSkipping' }
world.skyQuality = { cloudDebugView: null } // given back to the preset: the clouds are drawn again
```

**On the translucent surfaces.** The clouds are composed over the lit image before the transparents are
drawn, so a translucent surface behind a cloud would be drawn over it. Two things lay them right, both
read per vertex:

- `cloudShadowOnTranslucent` (a project switch, `false` by default, read once when the session opens):
  the clouds' shadow maps also shade the translucent surfaces. The shade of the forward directional light
  (below) is read from its clouds' shadow map at each vertex of a translucent surface and interpolated
  over the triangle, so it costs a vertex a map read and a pixel nothing. It applies where the forward
  light is one of the air's two lights that has a map this image: the sky quality's `cloudShadowMap` on
  (the default), the light's `castCloudShadows` on (off by default) and its `cloudShadowOnSurfaceStrength`
  above 0 (1 by default, the factor on how much of the shade the surfaces take). Like every run-time
  setting it is advertised to the tools by `runtimeToolsSchema` (field `cloudShadowOnTranslucent`, the
  "effects" quality group, no preset writes it) and held in the sky quality rules.
- `cloudFog` (a material option, `false` by default): a see-through (`transparent`) surface that is
  fogged (`fog` not `false`) receives the clouds in front of it as part of its fog — the cloud image is
  laid over the fog of each vertex of the surface, faded in over `cloudSoftBlendingDistanceOnTranslucent`
  kilometres from the cloud's front, so a surface behind a cloud is seen through it, not over it. A rough
  approximation that helps where a translucent surface lies behind a cloud (a window seen through a cloud
  bank, a particle sprite beyond a cloud); the surface needs the vertices to carry it, so a very large
  triangle shows the cloud at its corners only. Setting it on a material of a scene changes its blended
  programs, like `allowNegativeEmissive` changes the graph's.

`cloudFogLateOnTranslucent` (off), with `cloudFogLate` on and a trace size that rebuilds the image
(`'quarterToHalf'`, `'quarterToFull'`): the surfaces whose material has `cloudFog` read the cloud image
with the fog already laid on it, which the rebuild writes as one more image of the rebuilt size; off,
they read the image without the fog (the fog is laid on the clouds only when they are composed over the
lit image), so a translucent surface behind a cloud can show with another fog than the cloud's.
`cloudSoftBlendingDistanceOnTranslucent` (0.5), read from 0.0001, is the kilometres, from the cloud's
front, over which the cloud fades in over a translucent surface behind it. Off, the programs that draw a
translucent surface hold none of this code; with either on, they read both per vertex, the one that is
off giving its neutral value.

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

The model: [the clouds in the air and the sky light](../../engine/atmosphere-and-sky-light.md#atmosphere-and-sky-light) and
[the transparent surfaces](../../engine/transparent-surfaces.md#transparent-surfaces).
