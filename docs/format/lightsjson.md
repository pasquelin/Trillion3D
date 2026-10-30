# `lights.json`

The source's punctual lights in the engine's light contract (candela and lux as the source writes
them), world space: the one product that reads a light (type, colour, intensity, range, cone,
transform). A light of another type, a bad matrix or a non-positive intensity is counted in
`rejected`, never a failed compile.

- Versions: `SCENE_LIGHTS_VERSION`, `SCENE_LIGHT_CONTRACT` (`rust/compiler/lights.rs`);
  `IMPORTED_LIGHTS_VERSION` (`browser/lighting/importedLights.ts`). 2 writes the intensities as the
  source declares them, in candela and lux; 1 divided them by 683, and a 1 file is read as no light.
  `sceneLightVersion` is `SCENE_LIGHT_CONTRACT`, 4: the contract's lamp has an `intensityUnits`
  (unitless when it names none) and a spot an `innerConeAngle` and an `outerConeAngle`; a point or spot
  record here names `candelas`, the same light as under 2, and a spot its two cones as the source
  writes them (3 wrote a `coneAngle` alone). `SCENE_LIGHTS_VERSION` is 3 for the same change.
- Writes `rust/compiler/lights.rs:stage_scene_lights`; reads
  `browser/lighting/importedLights.ts:loadImportedLights` (an unknown version reads as no light).
