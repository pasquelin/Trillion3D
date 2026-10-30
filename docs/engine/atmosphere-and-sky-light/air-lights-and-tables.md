# Air, lights and tables

**Units.** Sun = brightest directional light of index 0 (`atmosphereSunIndex`, default 0) not flagged
`atmosphereSun: false`; illuminance `E` = colour × intensity (sRGB luminance weights). Added light replaces the sun only if brighter; a removed sun yields to the brightest other
(first added among equals); a changed light is rejudged likewise.

Eye radiance: `L = E · ∫ T(eye→p) · T(p→sun) · (σs_R φ_R + σs_M φ_M) dt` plus multiple-scattered
share, per steradian (`L = albedo / π · E · cosθ`). Surface lit by `E · T(ground→sun)`, written into the sun's light-buffer slot
(`atmosphereSun.ts`; transmittance integrated on CPU, 15 samples). Sun disk drawn at
`E · tint / (2π(1 − cos α))`, `α` angular radius, `tint` = `sunDiskTint`, × transmittance × rim
softening; each channel held under 64000 (exposed disk); image sky under 32256. Light colour × black
body at its temperature when `useTemperature` is on (`lightColour`, `scene/light/fields.ts`, 1000 to 15000 K).

**Two lights.** Air holds up to two lights, one per index (`SceneLight.atmosphereSunIndex`, 0 or 1,
default 0), each chosen as the sun is (index change = remove and re-add). Slots: `ATMOSPHERE_SLOT`
(second in `second*`).

- Air marches (`integrateAir`: sky table, haze volume, mean sky at 6 km, sky light capture) add the
  second light's scattering and, where the ray ends on ground, its bounce.
- Sky draws both disks.
- Surface lit by the second light gets its illuminance × transmittance, in its own slot.
- Saved world keeps the index (`SavedNode.light.atmosphereSunIndex`, only for 1).

**Tables** (`lighting/atmosphere/`): sizes and sample counts (`AirShape`, `shape.ts`) are quality
settings; defaults = reference's top level.

- Built when air changes: transmittance table (256 × 64, 10 samples, stored as square root, four half
  floats; four bytes at `transmittanceSmallFormat`); multiple-scattering table (32 × 32, 15 samples;
  first 8 of 64 sphere directions at `multiScatterHighQuality`).
- Built each image: sky seen from eye (192 × 104, 4 to 32 samples by distance, cap 32 ×
  `sampleCountScale`); haze volume (32 × 32 × 16 cells over 96 km, up to 4 samples per slice, at
  most 2 × `sampleCountScale`); mean sky radiance at 6 km (64 directions, `sphereSamples.ts`), fog's colour.
- Haze volume lives in a 32768-cell region of the light buffer (16384 in 32-bit floats,
  `skyTablesFullPrecision`): slices cut to fit; size in the view block (`VIEW_SLOT.volume`). Cells
  also go to a same-size `rgba16float` 3D texture (`hazeVolume`, `HAZE_VOLUME_FORMAT`, written by `storeHaze`) the fog pass samples with hardware
  filtering (`hazeSampledWgsl`; by hand at `skyTablesFullPrecision`); translucent layers, clouds and
  reflection rays read the region by hand.
- With `skyTableFast` off the sky pixel is marched (`atmosphereSamplesMin`, `atmosphereSamplesMax`).
- Atmosphere `inMainView` (on): the camera view draws the air. Off: black sky (`skyMain`, `AirFrame.hidden`), no
  opaque-surface haze march (`encodeOpaqueHaze`), haze volume builder writes the view block alone
  with kind 0 (`HAZE_VIEW_WGSL`); sun light, tables and sky light capture unchanged.

**Shade on air.** A directional light with `SceneLight.shadowsAir` shades the air: each sky-table and
haze-volume march step reads its virtual shadow map (`airShadow`, `airShadowWgsl.ts`; one sample),
multiplying scattered light; multiple-scattered share stays unshaded. Off:
`atmosphereSampleLightShadowMap`.
