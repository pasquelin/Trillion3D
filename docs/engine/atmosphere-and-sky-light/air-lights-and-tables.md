# Air, lights and tables

**Units.** The sun is the brightest directional light of index 0 (`atmosphereSunIndex`, 0 by default;
the second light, below, has index 1) not flagged `atmosphereSun: false`; its illuminance `E` is its
colour times its intensity, each channel weighed by the eye's sensitivity (sRGB luminance weights; the
fog's sun the same). The store holds the sun as lights come and go, with or without air: an added
light replaces it only if brighter; a removed sun gives its place to the brightest of the others, the
first added of equals (a removal moves no one's place in that order); a changed light is judged again
the same way, the sun keeping its place against an equal.

The radiance reaching the eye through the air is `L = E · ∫ T(eye→p) · T(p→sun) · (σs_R φ_R + σs_M φ_M) dt`
plus the multiply-scattered share, per steradian: the scale a surface reads (`L = albedo / π · E ·
cosθ`), so a 10-lux sun gives the same sky-to-sun ratio at any intensity. A surface is lit by `E ·
T(ground→sun)`, written into the sun's own slot of the light buffer by the store
(`atmosphereSun.ts`; the declared light is untouched; the transmittance is integrated on the CPU over 15 samples, once when
the air or sun moves). The sun's disk is drawn at `E · tint / (2π(1 − cos
α))`, `α` its angular radius, `tint` its `sunDiskTint`, times the transmittance toward it and the rim's softening, each
channel held under 64000 after the product and after the image's pre-exposure (sky and disk are multiplied by it
once; an exposed disk is held under 64000 per channel, the image's sky under 32256). A light's colour
is multiplied by a black body's at its temperature when `useTemperature` is on (`lightColour`,
`scene/light/fields.ts`, clamp 1000 to 15000 K), before the intensity, in the sun's choice, its
illuminance and its light on surfaces.

**Two lights.** The air holds up to two lights, one per index (`SceneLight.atmosphereSunIndex`, 0 or
1, 0 by default), each chosen among the lights that may light the air as the sun is (brightest,
strictly, at adding; the brightest of its index at removal; a light changing index is removed and
added again). Their directions, illuminances and disks are slots of the atmosphere's block
(`ATMOSPHERE_SLOT`, the second in `second*`, its disk slot's last lane saying there is one). Every
march of the air (`integrateAir`) adds, per step, the second light's own scattering (phase, planet
shadow, transmittance from the table, multiple scattering) to the first's and, where the ray ends on
the ground, its bounce; the sky table, haze volume, mean sky at 6 km and sky light's capture all march
both. The multiple-scattering and transmittance tables depend on the air alone. The sky draws both
disks. A surface lit by the second light receives its illuminance times the transmittance toward it,
written into its own slot as the sun's is. With no second light the marches run their per-light loops
once and read nothing of it. A saved world keeps each light's index (`SavedNode.light.atmosphereSunIndex`,
written only for index 1).

**The tables** (`lighting/atmosphere/`): sizes and sample counts are the sky's quality settings
(`AirShape`, `shape.ts`; defaults the reference's top level); the programs are written once per shape
and remade when the settings make another.
- Built when the air changes: a transmittance table (256 × 64, 10 samples, stored as its square root,
  in four half floats or, at `transmittanceSmallFormat`, four bytes) and a multiple-scattering table
  (32 × 32, 15 samples; from the first 8 of 64 directions over the sphere at `multiScatterHighQuality`).
- Built each image, a thread to a texel: the sky seen from the eye (192 × 104, 4 to 32 samples by
  distance, the cap no more than 32 times `sampleCountScale`), the haze volume (32 × 32 × 16 cells over
  96 km, up to 4 samples a slice, twice `sampleCountScale` at most), and the mean sky radiance at 6 km
  (the 64 directions of a grid jittered by a fixed generator, `sphereSamples.ts`) that the fog takes on.
- The haze volume lives in a region of the light buffer of 32768 cells (16384 in 32-bit floats,
  `skyTablesFullPrecision`): the slices are cut to fit, and a surface reads its size from the view's
  block (`VIEW_SLOT.volume`). Each cell is also stored in a 3D texture of the same cells (`hazeVolume`,
  `rgba16float`, `HAZE_VOLUME_FORMAT`, written by `storeHaze` beside the region), which the fog pass
  samples with the hardware's filter (`hazeSampledWgsl`); at `skyTablesFullPrecision` it reads the
  cells by hand from the region, which holds them whole. The translucent layers, the clouds and the
  reflections' rays still read the region by hand.
- A sky pixel is marched, not read from the table, at `skyTableFast` off (`atmosphereSamplesMin`,
  `atmosphereSamplesMax`, jittered by the blue noise).
- The atmosphere's `inMainView` (on) says whether the camera's view draws the air. Off: the sky pass
  writes a black sky (`skyMain`, `AirFrame.hidden`), the fog pass lays the fog over it as over the
  background, the haze marched on the opaque surfaces (`encodeOpaqueHaze`) is not drawn, and the haze
  volume builder writes the view's block alone with its kind 0 (`HAZE_VIEW_WGSL`) so no surface, fog or
  cloud reads a haze; the sun's light tinted by the air, the tables and the sky light's capture are
  unchanged.

**Shade on the air.** A directional light that asks for it (`SceneLight.shadowsAir`) shades the air: at
each step of the sky table's and haze volume's march, the light's virtual shadow map is read at the
step's place (`airShadow`, `airShadowWgsl.ts`; one sample, as the fog's volume reads the sun's) and
multiplies the light scattered into the ray, the multiply-scattered share left unshaded. Planet
shadow and scene shadow multiply. `atmosphereSampleLightShadowMap` turns the read off.

