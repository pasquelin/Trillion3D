# Live material values

A material written on `color`, `emissive`, `emissiveIntensity`, `metalness`, `roughness` or
`opacity` repaints in place, opaque or blended, session kept. A change it cannot hold in place
(texture, kind, side, transparency, values another material object shares) is copy-on-write: the
copy is a new material, and meshes wearing it join the running session; the session is never
reopened for it. `world.diagnostic.sessions` counts sessions a world opened: one, unless the device
was lost or an option changed (`session-reopen`, `cause`).

## Physical material extras

`material.meshPhysical` accepts `anisotropy` (0–1), `anisotropyRotation` (radians), `clearcoat`,
`clearcoatRoughness`, drawn with `anisotropyMap` (RG direction, B strength), `clearcoatMap` (R),
`clearcoatRoughnessMap` (G), `clearcoatNormalMap` (`clearcoatNormalScale`). Each map: native size,
own filters, wrap, transform and UV channel, read as linear data. A map reads the UV channel its
`texCoord` names, `TEXCOORD_0` to `TEXCOORD_7`, from compiled geometry (eight sets) or source
geometry (two); a geometry without that set reads the first. A transparent surface carries the
first set plus the first past it that one of its maps reads. A rectangle light stretches its
specular lobe along the anisotropy.

### Cloth

A cloth is a `material.meshPhysical` with `sheen` above 0, `sheenColor` (fuzz colour, black unless
set), `sheenRoughness` (cloth amount, 0 to 1, 0 unless set), drawn with `sheenColorMap` (sRGB) and
`sheenRoughnessMap` (alpha channel), each multiplying its factor.

- Specular of every light = standard lobe mixed with inverse-GGX fuzz lobe of the fuzz colour by
  cloth amount; diffuse stays Lambert; fuzz times cloth amount joins the indirect diffuse colour
  (environment, sky light, probes, volumetric lightmap).
- No coat or anisotropy: `transmission` above 0, then `clearcoat` above 0, win over sheen, which is
  dropped. A glTF material declaring `KHR_materials_transmission` or `KHR_materials_clearcoat`
  beside `KHR_materials_sheen` is read so whatever the factors (`gltf-sheen-dropped`).
- glTF `specularColorFactor`, `specularColorTexture` and iridescence are kept in the compiled table,
  not drawn (`gltf-specular-color-not-drawn`, `gltf-iridescence-not-drawn`).

### Specular intensity

`specularIntensity` (0 to 1): dielectric specular input; normal-incidence reflectance is 0.08 of
it; default 0.5 (4%), 1 gives 8%, 0 no highlight; metals ignore it. `specularIntensityMap`
multiplies it by an image's alpha channel. glTF `KHR_materials_specular` writes both
(`specularFactor`, `specularTexture`, factor 1 when none named); any surface declaring one is read
as physical, zero included. A surface wearing a graph takes specular from the graph's `specular`
output.

```ts
const dull = material.meshPhysical({ color: 0x8090a0, roughness: 0.4, specularIntensity: 0.2 })
```

```ts
const velvet = material.meshPhysical({
  color: 0x401020,
  roughness: 0.8,
  sheen: 1,
  sheenColor: 0xff80a0,
  sheenRoughness: 0.6,
})
```

With a volumetric lightmap (`volumetricLightmap`, on by default), the indirect pass lights each lit
opaque pixel's diffuse colour with third-order harmonic irradiance along its normal; blended
surfaces read none.

## Clear coat

A clear coat (`clearcoat` above zero, material's or graph's) lies over the base as reference's clear
coat shading model, in every light, opaque or blended.

- Coat = dielectric GGX lobe, reflectance 0.04, own roughness (`clearcoatRoughness`, held at least
  0.02), weighted by `c`.
- Base lit through it: diffuse and specular times `(1 − F)²`, F = coat Fresnel at the half vector,
  metal base absorbing, light angle refracted by index 1.5.
- Environment, bounce and reflections see the base through the coat: colour attenuated by coat
  Fresnel along the view, base reflection weighed by what the coat passes, coat reflection added.
- Coat shares the base normal; a material's coat normal map is read only with
  `world.shading = { clearCoatNormal: true }`.
- Cost: an image-sized lobes target and a lobed lighting program wherever a surface has one.

## Subsurface and shadows

Lit materials may declare `subsurfaceColor` (black = off, default) and optional `subsurfaceMap` for
thin **double-sided** surfaces such as foliage: light arriving through the back, tinted. Each light
gives the eye its energy times `subsurfaceColor` times a wrapped cosine, `(½ − N·L) / (3/2)²` held
to 0..1, times a broad lobe peaking where the eye looks into the light; no 1/π, no cosine of its
own.

Not a volume: glass volumes use physical `transmission`, `thickness`, `attenuationColor`,
`attenuationDistance`. Thickness is in mesh units, as glTF: a placement scaled twice crosses
twice the path. glTF `KHR_materials_volume` without `attenuationDistance` attenuates over one
metre.

A blended or transmissive surface casts no shadow: shadow maps hold opaque surfaces and cutouts. A
shadow-casting light with a source size (point or spot `radius`, rectangle `size` whose shadow
source radius is half its width, sun `angularRadius`) casts penumbrae hardening at contact, on
opaque and blended surfaces; size zero casts hard shadows.
