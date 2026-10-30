# Thin translucent

A lit translucent surface whose graph wires `transmittanceColor` or `surfaceCoverage` is a thin
translucent surface, the reference's thin translucent shading model (number 11 of
`GRAPH_SHADING_MODELS`): an infinitely thin sheet that absorbs the background behind it, under a lit
layer. The `opacity` output is the coverage of the lit layer (base colour and emission) over the
sheet, `surfaceCoverage` the coverage of the whole, and `transmittanceColor` the colour the
background keeps for a view perpendicular to the surface; the colour is taken to the power one over
the cosine of the view with the normal, which makes the sheet thicker at a slant. The light entering
and leaving the sheet is reduced by Fresnel (on the surface's specular colour, which follows
`baseColor`, `metallic` and `specular`), and the specular of the lights and of the reflections is
added over it. Both outputs are read in [0, 1].

Where the device is granted `dual-source-blending` the layer adds its light and multiplies the
background by its transmittance in one pass; without it, the layer is blended by the grey coverage
of that multiplier (its premultiplied colour, one minus the average of the multiplier as alpha).
Like the reference's, the surface is lit per pixel, has the physical lighting only (a pixel naming
model 11 in an opaque surface is lit as `defaultLit`), and marks the temporal pass's responsiveness
as if its opacity were one.

A glTF material with `KHR_materials_transmission` is such a surface, as the reference imports it:
the transmittance colour is the base colour times the transmission, the lit layer covers by the
largest of one minus the transmission, the metalness and the roughness, and the coverage is one. A
material whose alpha mode is `mask` is clear (covers nothing, transmits all, has no specular) where
its base map's alpha reaches 0.333 and glass elsewhere (it is not cut by its cutoff).

```js
import { material } from 'trillion3d'

// A tinted pane: the background keeps 20% of its red, 50% of its green and 90% of its blue seen straight on,
// the pane itself, a faint white, covers a tenth.
const g = material.graph('surface')
g.output('baseColor', g.constant(1, 1, 1))
g.output('roughness', g.constant(0.05))
g.output('opacity', g.constant(0.1))
g.output('transmittanceColor', g.constant(0.2, 0.5, 0.9))
g.output('surfaceCoverage', g.constant(1))
const pane = material.meshPhysical({ graph: g, transparent: true })
```

A graph that also wires `pixelDepthOffset` on a translucent surface moves the depth its
responsiveness mark is tested at: the temporal pass's responsiveness is written by a pass of its
own, on every device, which draws the translucent layers again into the responsive target, tested
against the opaque depth at the depth the offset moves each pixel to, so a layer pushed behind the
opaque surface leaves no mark. The colour passes write no mark.
