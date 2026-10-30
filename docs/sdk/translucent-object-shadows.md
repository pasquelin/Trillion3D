# Per-object translucent shadows

A translucent object can cast a shadow of its own opacity into the classic shadow maps of a light. It is off by default: with the switch off no
pass is made and no memory is held.

- `translucentObjectShadows` (`false`, an option of `createWorld`) turns the feature on. It needs `shadowVirtualEnable` off
  (the lights' classic shadow maps); lights with virtual shadow maps never use it.
- `light.castTranslucentShadows` (`true`) lets translucent surfaces cast into that light's shadow.
- `object.castVolumetricTranslucentShadow` (`false`) makes the object cast one. The object must also cast a dynamic shadow.
- Material fields, read per material:
  - `translucentShadowDensityScale` (`0.5`): scale on the opacity of the shadow the surface casts.
  - `translucentShadowStartOffset` (`100`, centimetres): moves the start of the shadow along the light, times the object's largest scale.
  - The self shadow (a translucent surface lit from the translucency lighting volume shadowed by its own object, from the sun):
    - `translucentSelfShadowDensityScale` (`2`): scale on the density the object's layers add between the sun and the surface.
    - `translucentSelfShadowSecondDensityScale` (`10`) and `translucentSelfShadowSecondOpacity` (`0`): a second, tighter gradient laid over the first, weighted by the opacity.
    - `translucentBackscatteringExponent` (`30`): the lobe of the sun's light a subsurface surface scatters toward a viewer who looks at the sun through it.
    - `translucentMultipleScatteringExtinction` (`[1, 0.833, 0.588]`): the density is divided by it per colour channel, so the shadow is tinted.

Each subject (a light and an object) is drawn from the light, whole, at its finest level of detail: every cluster of level 0 of the object's
translucent surfaces, whether or not the camera's cut kept it; the light's own frustum clips what lies outside. The two float atlases of the
subjects hold a Fourier series of the opacity along the light, which the light's shadow reads back where it is projected. For a directional light
the depth is held to the subject's near end. An object outside the camera's view still casts onto the ground the camera sees. The shadow is
taken into the lights' masks whether the local lights are projected in one pass (`shadowOnePassProjection`) or each alone, and the masks are
projected again, not held, in every image that has a subject (and in the image after the last one).

A translucent surface lit from the translucency lighting volume (`translucencyLighting`: `volume`, `volumetric` or `volumetricNonDirectional`) of an object
that casts such a shadow from a sun also reads that shadow at its own place: the sun's part of the volume's light (the volume keeps the share of each sun that
reached a cell) is taken away where the density between the sun and the surface shadows it, and a subsurface surface (a non-zero `subsurface` colour) gains the
sun's light scattered toward the viewer. The shadow fades with the subject's fade and is ignored outside the rectangle the subject was drawn in. It follows the
sun's subject of the object (the last one, when two suns cast), one record for each (subject, material) pair of the image, however many: no item loses its self shadow.

The programs read it when `translucentObjectShadows` is on; turning the switch on or off while the session runs builds the translucent programs again once (off the
frame, the image drawn again when they land), as the shadows into the lights already follow it every image. The records live in one packed table texture that grows
with the frame; the subjects' atlas is one 2D array texture, a layer pair per atlas, read as a second sampled texture where the device grants it (the engine asks the
adapter for 26 sampled textures a stage); a device that grants one fewer copies the subjects' rectangles into the packed table and filters them by hand with the same
weights, and one that has none to spare (the 16 WebGPU guarantees) also copies the light profiles' atlas into the table and reads the profiles from it with the same bilinear weights, so the table takes the texture's place: the base device draws the same image. The packed table is a 2D array texture of 4096-texel rows (64 KiB a row, 256 MiB a layer of 4096 rows) that grows by half again with the frame: rectangles are packed side by side along its rows (two subjects of 1024 px take 2 x 512 texels across and, with their two planes, about 2 048 rows: 128 MiB, or 134 MB, not a layer each), a rectangle wider than a row is cut into blocks, and it goes on in the next layer only when a layer is full. The rectangles go through a staging buffer in bands within the device's buffer size, and the atlas is drawn and copied again only when the subjects, the casters or the scene changed. The table is made aside from the frame (under the device's out-of-memory scope and the memory budget, one grow at a time) and adopted at the start of an image once granted; the table it replaces is let go only then, and where the records do not fit the table it had (the first table, or a growth) the frames are held, never presented without them, until the device answers (the device answer 'translucent object shadow table'); where only the usage changes (the table must be writable by the sorted depth's pass), the table it had keeps serving its records, without the sorted depth, until the new one is adopted. No record, rectangle or profile is dropped as long as the device makes the table; a device that is out of memory for it, or that has too few layers, keeps the table it had (the surfaces then take no shadow of their own once it is too small, and the sorted translucency, whose depth lies in the table, keeps its layers in the blends' pass), says so once as a `gpu-out-of-memory` diagnostic and does not ask again for as many rows or more; fewer rows are asked exactly, before any margin. The profiles and the sorted depth lie before the records, so the records of an image never move them. A 16-texture device that also sorts the translucency folds the sorted depth into the table too (a small pass writes it before the layers are collected). No storage buffer is bound by the read.

```ts
const world = await createWorld({ canvas, translucentObjectShadows: true })
sun.castTranslucentShadows = true
cloud.castVolumetricTranslucentShadow = true
cloudMaterial.translucentShadowDensityScale = 0.8
cloudMaterial.translucentShadowStartOffset = 0
// The self shadow of the same material: a darker core, a tinted shadow, a bright rim toward the sun.
cloudMaterial.translucentSelfShadowDensityScale = 3
cloudMaterial.translucentMultipleScatteringExtinction = [1, 0.8, 0.6]
cloudMaterial.translucentBackscatteringExponent = 20
```
