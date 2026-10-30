# Reflections and the captured-scene sky light

**Reflections.** A reflection ray that leaves the scene reaches the sky along its direction
(`reflectionEnvironment`, `lighting/reflections/field.ts`): the sky light's cube, sharp for a ray, at
the lobe's roughness for the field's read. A scene with an atmosphere and no sky light shows none, the
sky a ray reaches being the sky light's alone; a scene with neither keeps the flat background the
screen draws. Where the probes hold the sky, a reflection's field takes the environment for the share
they do not answer alone, the sky never twice.

**Sky light, captured scene** (`modules/sky/skyLight/captureScene.ts`). A sky light whose
`realTimeCapture` is off and whose `sourceType` is `'capturedScene'` (the default) lights the scene
with the scene itself, drawn once into its cube from the light's position. Six cameras, one per cube
face (+x, -x, +y, -y, +z, -z), each square with a 90 degree field and its nearest distance the light's
`skyDistanceThreshold` (150000 cm, so nothing nearer than 1500 m is in the cube), draw the scene aside
(`Engine.captureHdrViews`, `frame/io/hdrCapture.ts`) at the cube's side (`cubemapResolution`, made a
power of two) times `skyLightCaptureSupersample` (1). A face's image is the lit linear radiance, before
exposure, effects and tone curve; it is clamped to the half float's range, the colour below the horizon
is the light's `lowerHemisphereColor` by its `lowerHemisphereCoverage` when
`lowerHemisphereIsSolidColor`, and it is copied into the face (`copySceneFaceMain`); then the mips, the
nine harmonics and the roughness filter are made (`captureFilter.ts`), as for a specified cubemap.
- The harmonics are summed from the captured cube's mips, before the filter (`capturedIrradianceMain`):
  a grid of 32 by 32 texels on each face, read bilinearly at the mip of that side (the top one for a
  smaller cube), each texel weighted by the share of the sphere it stands for; a coefficient is 4π
  times the weighted sum of the radiance times the basis, over the sum of the weights.
- The cube is written at a pre-exposure of 1. The mean of the sky radiance the light reports is the
  harmonics' last vector, as for any source.

The faces are drawn by a view of their own with `ViewOverrides` (`frame/backend/state/viewOverrides.ts`):
no sky light, every surface of roughness 1, no particle, light shaft, light function, effect, exposure,
tone curve or temporal pass, the cut asked at `skyLightCaptureLodDistanceScale` (1, a value of zero or
less being 1), no reflection traced; with `captureEmissiveOnly` the lights, probes, reflections and
occlusion are off and the diffuse and specular colours are zero, so only what the surfaces emit is in
the cube. The main view holds the neutral overrides: its programs read none of them, and the rewrite of
the roughness and diffuse colour (`lighting/deferred/surfaceOverride.ts`) is a pass encoded for a
capture view only.

It is drawn between two frames, after the frame is submitted, never inside it; the cube read by the
lighting (`read()`) is the last one made, and stays until the next replaces it. A capture is asked when
the light is created, when it first captures a scene, when its cubemap or the angle of its cubemap
changes, when `realTimeCapture` is switched, when its cube is made again (a new `cubemapResolution`),
and by `recapture()`; not when its colour, intensity, lower hemisphere or distance threshold changes,
nor when it moves: those apply at the next capture. A static light is not captured, nor is a light with
`affectsWorld` off.

```ts
const part = resolveSkyLight({
  realTimeCapture: false, // the scene is captured, not the sky
  sourceType: 'capturedScene',
  mobility: 'stationary', // a static light is not captured
  cubemapResolution: 128,
  skyDistanceThreshold: 150000, // centimetres: the near plane of the faces
  captureEmissiveOnly: false,
})
const capture = createSkyLightCapture(device, report)
const input = {
  part,
  width: skyLightCubeWidth(part, maxCubeSide),
  position: [0, 10, 0],
  frame,
  atmosphere: false,
  fogShown: false,
}
// Once a frame, after it is submitted:
if (capture.sceneDue(input)) await capture.captureScene(engine, input)
const sky = capture.read() // the cube, its mips and the harmonics; none before the first capture
// The world changed (a building came down): the sky is captured again at the next look.
capture.recapture()
```
