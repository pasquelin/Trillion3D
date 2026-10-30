# Reflections and the captured-scene sky light

**Reflections.** A reflection ray leaving the scene reaches the sky (`reflectionEnvironment`,
`lighting/reflections/field.ts`): sky light cube, sharp for a ray, at lobe roughness for the field.
Atmosphere without sky light shows none; neither: flat background.
**Sky light, captured scene** (`modules/sky/skyLight/captureScene.ts`). `realTimeCapture` off and
`sourceType` `'capturedScene'` (default): the scene is drawn once into the cube from the light's
position: six 90 degree cameras (faces +x, −x, +y, −y, +z, −z), near = `skyDistanceThreshold`
(150000 cm), drawn aside (`Engine.captureHdrViews`, `frame/io/hdrCapture.ts`) at
`cubemapResolution` (power of two) × `skyLightCaptureSupersample` (1). Face = lit linear radiance
before exposure, effects, tone curve; clamped to half-float, copied by `copySceneFaceMain`; below
horizon `lowerHemisphereColor` × `lowerHemisphereCoverage` when `lowerHemisphereIsSolidColor`; then
mips, harmonics, filter (`captureFilter.ts`).

- Harmonics from the captured mips, before the filter (`capturedIrradianceMain`): 32 × 32 texels per
  face; 4π × sphere-share-weighted radiance × basis / weight sum. Cube at pre-exposure 1.

Faces use `ViewOverrides` (`frame/backend/state/viewOverrides.ts`): no sky light, roughness 1, no
particle, shaft, light function, effect, exposure, tone curve, temporal pass or reflection; cut at `skyLightCaptureLodDistanceScale` (1; <= 0 = 1). `captureEmissiveOnly`: no lights, probes,
reflections, occlusion; diffuse and specular zero (`lighting/deferred/surfaceOverride.ts`).

Drawn after frame submit; `read()` = last cube made. Asked when: light created; cubemap or
cubemap angle changes; `realTimeCapture` switches; cube remade; `recapture()`; not on colour, intensity, lower
hemisphere, threshold or move. Static light or `affectsWorld` off: not captured.

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
