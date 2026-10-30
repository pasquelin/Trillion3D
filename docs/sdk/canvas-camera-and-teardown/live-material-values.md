# Live material values

A material written on `color`, `emissive`, `emissiveIntensity`, `metalness`, `roughness` or
`opacity` is repainted in place, opaque or blended, the session kept (a colour picker dragged for
ten seconds keeps one session; a glass fading out keeps its material). A change it cannot hold in
place — a texture, a kind, a side, transparency, values another material
object shares — is copied on write: the copy is a new material, and the meshes that wear it join
the running session as any mesh added to the scene does, the session never opened again for it.
`world.diagnostic.sessions` counts the sessions a world opened: one, unless the device was lost or
an option changed (`session-reopen`, `cause`).

`material.meshPhysical` accepts `anisotropy` (strength, 0–1), `anisotropyRotation` (radians),
`clearcoat` and `clearcoatRoughness`, drawn with `anisotropyMap` (RG the direction, B the
strength), `clearcoatMap` (R), `clearcoatRoughnessMap` (G) and `clearcoatNormalMap`
(`clearcoatNormalScale`), each map at its native size with its own filters, wrap, transform and UV
channel, read as linear data. A map reads the UV channel its `texCoord` names, `TEXCOORD_0` to
`TEXCOORD_7`, from the compiled geometry page (eight sets) or from the source geometry (two); a
geometry without that set reads the first. A transparent surface carries the first set and one
more, the first past it that one of its maps reads. A rectangle light stretches its specular lobe
along the anisotropy.

A cloth — velvet, woven fabric — is a `material.meshPhysical` with `sheen` above 0 (the switch of the
cloth shading model), `sheenColor` (the fuzz colour, black unless set) and `sheenRoughness` (the
cloth amount, 0 to 1, 0 unless set), drawn with `sheenColorMap` (sRGB) and `sheenRoughnessMap` (its
alpha channel), each multiplying its factor. The specular of every light is then the standard lobe
mixed with an inverse-GGX fuzz lobe of the fuzz colour by the cloth amount, the diffuse stays
Lambert's, and the fuzz times the cloth amount joins the diffuse colour of the indirect light (the
environment's, the sky light's, the probes' and the volumetric lightmap's). The cloth model has
neither coat nor anisotropy, and a surface has one model: a `transmission` above 0, then a
`clearcoat` above 0, win over the sheen, which is then left out; a glTF material that declares
`KHR_materials_transmission` or `KHR_materials_clearcoat` beside `KHR_materials_sheen` is read so
whatever the factors (`gltf-sheen-dropped`). A glTF material's `specularColorFactor` and
`specularColorTexture`, and its iridescence, are kept in the compiled table and not drawn
(`gltf-specular-color-not-drawn`, `gltf-iridescence-not-drawn`).

`specularIntensity` (0 to 1) is the specular input of a dielectric: its reflectance at normal
incidence is 0.08 of it, so a surface that declares none keeps 0.5 (4%), 1 gives 8% and 0 no
highlight; a metal takes its base colour and ignores it. `specularIntensityMap` multiplies it by the
alpha channel of an image. A glTF material's `KHR_materials_specular` writes both as it declares
them (`specularFactor`, `specularTexture`, factor 1 when the extension names none); any surface that
declares one is read as a physical surface, a zero included. A surface that wears a graph takes its
specular from the graph's `specular` output instead.

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

With a volumetric lightmap in the scene (`volumetricLightmap`, on by default), a pass of its own reads
its third-order harmonics at every lit opaque pixel and the indirect pass lights the pixel's diffuse
colour with their irradiance along its normal, as it does the environment's; a blended surface reads
none.

A clear coat (`clearcoat` above zero, a material's or a graph's) lies over the base as the reference's clear coat shading
model has it, in every light, on an opaque surface as on a blended one: the coat is a dielectric GGX lobe of
reflectance 0.04 at its own roughness (`clearcoatRoughness`, held at 0.02 at least), weighted by `c`; the base is lit through it —
its diffuse and its specular under the coat's two crossings, `(1 − F)²`, F the coat's Fresnel at the half vector, a metal base
absorbing along the refracted path of the light and the eye, the light's angle refracted by the coat's index of 1.5.
The environment, the bounce and the reflections see the base through the coat too: its colour is attenuated by the
coat's Fresnel along the view (a metal's replaced by its absorbed colour), the base's reflection is weighed by what the coat lets
through and the coat's own reflection is added. The coat shares the base's normal — the coat normal map a material carries is
read only with `world.shading = { clearCoatNormal: true }`. A coat costs a lobes target the size of the image and a
lobed lighting program wherever a surface carries one.

Lit materials can declare `subsurfaceColor` (black, off, by default) and an optional `subsurfaceMap`
for thin **double-sided** surfaces such as foliage: light arriving through the back, tinted.
Each light gives the eye its energy times `subsurfaceColor` times a wrapped cosine, `(½ − N·L) / (3/2)²`
held to 0..1 (the front takes light too, up to a cosine of one half), times a broad lobe that peaks
where the eye looks into the light; it has no 1/π and no cosine of its own.
Diffuse thin-surface transmission, not a volume: a glass volume uses physical `transmission`,
`thickness`, `attenuationColor` and `attenuationDistance`. The thickness is in the mesh's own units,
as glTF's: a placement scaled twice crosses, refracts and shadows through twice the path. A glTF
`KHR_materials_volume` that names no `attenuationDistance` attenuates over one metre.

A blended or transmissive surface casts no shadow: the shadow maps hold the opaque surfaces and the
cutouts, and glass, smoke and a light beam let the light of the sun and the lamps through. A shadow-casting light with a source size — a point or spot `radius`, a rectangle's `size` (its
shadow's source radius is half its width), a sun's `angularRadius` — casts penumbrae that harden at contact, traced through the shadow maps on opaque
and blended surfaces alike; a size of zero casts hard shadows.
