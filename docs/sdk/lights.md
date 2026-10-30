# Lights

Only a light the host declared lights an opaque surface: no fixed ambient, constant sky or authored
lighting; a windowless corridor stays black at noon. Emission is always added.
`world.exposure` is the camera exposure on linear radiance before tone mapping: `'auto'` (default,
also `true`) measures each image on the GPU and brings its mean brightness to middle grey, so a sunlit
view and a shaded one land on the same average whatever the lamps' power; a number above zero is the
manual multiplier, used as it is (`false` is 1). A view lit by no declared lamp shows its albedo
as it is, with no exposure and no curve. `world.toneMapping` is `'filmic'` by default
([ENGINE.md](../engine/exposure-and-the-display-curve.md#exposure-and-the-display-curve)). `meshNormal`
and `meshDepth` surfaces are output as stored. A map a family never reads is refused by name: a
`meshStandard` `gradientMap` (no model reads it), a `meshMatcap` `map`, a `meshMatcap` or `meshNormal`
`normalMap`; `meshMatcap`, `meshNormal` and `meshDepth` ignore an `aoMap`. Transparent surfaces follow
another lighting rule: [ENGINE.md](../engine/transparent-surfaces.md#transparent-surfaces).

`scene.background` is the colour behind every object (`null` by default); set or written through
its methods (`set`, `setRGB`, `setHex`, `setHSL`), it shows next frame; a direct `.r`, `.g` or `.b`
write needs it set again. A picture background is refused (`UNSUPPORTED_SCENE_UPDATE`).

- [Sky module](lights/sky-module.md)
- [Height fog part](lights/height-fog-part.md)
- [Atmosphere part](lights/atmosphere-part.md)
- [Clouds part](lights/clouds-part.md)
- [Declared lights](lights/declared-lights.md)
- [Simple lights](lights/simple-lights.md)
- [Rectangle lights' pictures](lights/rectangle-lights-pictures.md)
- [Light functions](lights/light-functions.md)
- [A lamp's range is authored, and no frame shortens it](lights/a-lamps-range-is-authored-and-no-frame-shortens-it.md)
- [Every mesh casts a shadow unless it says `castShadow = false`](lights/every-mesh-casts-a-shadow-unless-it-says-castshadow-false.md)
- [One primitive out of the shadow maps: `castsShadowMaps = false`](lights/one-primitive-out-of-the-shadow-maps-castsshadowmaps-false.md)
- [A sun's shadow distance and its far casters](lights/a-suns-shadow-distance-and-its-far-casters.md)
- [Classic shadow maps' depth atlas](lights/classic-shadow-maps-depth-atlas.md)
- [Clipmap statistics](lights/clipmap-statistics.md)
- [Clusters table](lights/clusters-table.md)
- [A see-through surface casts no shadow](lights/a-see-through-surface-casts-no-shadow.md)
- [A see-through surface reads the sun's shadow, with one sample](lights/a-see-through-surface-reads-the-suns-shadow-with-one-sample.md)
- [Contact shadows](lights/contact-shadows.md)
- [A light that follows the exposure](lights/a-light-that-follows-the-exposure.md)
- [A light that is left out at a distance](lights/a-light-that-is-left-out-at-a-distance.md)
- [Lighting channels](lights/lighting-channels.md)
- [A see-through surface lit from the translucency lighting volume](lights/a-see-through-surface-lit-from-the-translucency-lighting-vol.md)
- [Translucency global illumination volume](lights/translucency-global-illumination-volume.md)
- [Single-layer water](lights/single-layer-water.md)
- [Heterogeneous volumes: voxel grids and the volumetric shadow map](lights/heterogeneous-volumes-voxel-grids-and-the-volumetric-shadow.md)
- [The scattering of the light under a surface (subsurface profile)](lights/the-scattering-of-the-light-under-a-surface-subsurface-profi.md)
- [The pass of the image a see-through surface is drawn in](lights/the-pass-of-the-image-a-see-through-surface-is-drawn-in.md)
- [A lamp's source radius and its housing](lights/a-lamps-source-radius-and-its-housing.md)
- [A lamp's cone, fall-off and share of light](lights/a-lamps-cone-fall-off-and-share-of-light.md)
- [Lights imported from the source file](lights/lights-imported-from-the-source-file.md)
