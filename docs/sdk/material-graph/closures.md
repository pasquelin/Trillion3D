# Closures: several layers per pixel

A surface graph is one closure by default: its wired outputs are one slab. A graph can instead hold a
closure tree: slabs (the wires of one closure's attributes) combined by operators. The tree is
flattened to closures, at most `closuresPerPixel` (4 by default, 1 to 8); a tree with more is
simplified by blending its deepest operators into one closure each until it fits. A graph without a
tree is the one-closure case and compiles exactly as before.

```ts
const g = material.graph('surface')
const paint = g.slab({
  baseColor: g.constant(0.8, 0.1, 0.1),
  roughness: g.constant(0.3),
  clearCoat: g.constant(1),
})
const rust = g.slab({ baseColor: g.constant(0.4, 0.2, 0.1), roughness: g.constant(0.9) })
const worn = g.horizontalMix(paint, rust, g.scalarParameter('wear', 0.25)) // foreground share
g.closures(g.weightClosure(worn, 1))
mesh.material.graph = g
```

| Call                                                              | Closure operator                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slab(attributes)`                                                | a leaf: `baseColor`, `metallic`, `specular`, `roughness`, `emissive`, `normal`, `ambientOcclusion`, `subsurfaceColor`, `anisotropy`, `tangent`, `clearCoat`, `clearCoatRoughness`, `cloth`, `clearCoatBottomNormal` |
| `horizontalMix(background, foreground, mix = 0.5, blend = false)` | side by side: the foreground takes `mix`, the background the rest                                                                                                                                                   |
| `verticalLayer(top, base, blend = false)`                         | the base seen through the top                                                                                                                                                                                       |
| `addClosures(a, b, blend = false)`                                | both, each at its own coverage                                                                                                                                                                                      |
| `weightClosure(input, weight)`                                    | the closure scaled by `weight` (0 to 1)                                                                                                                                                                             |
| `closures(root)`                                                  | makes `root` the tree (at most 15 operators once simplified)                                                                                                                                                        |

`blend = true` asks the operator's subtree to be one closure with its parameters mixed. The first
slab of the walk (top before base, background before foreground) is the primary one, which the
single-closure passes shade; the closure outputs (`baseColor`, ...) are wired on slabs, not on the
graph, once a tree is set. Three settings, on the world (`world.closures`):

```ts
world.closures = {
  closuresPerPixel: 2,
  closureCountFromMaterial: true,
  stochasticClosureLighting: false,
}
```

`closureCountFromMaterial` (on) makes a view keep as many closures a pixel as the most any material
in view has, up to `closuresPerPixel`; off, every view keeps `closuresPerPixel`.
`stochasticClosureLighting` (off) chooses how the sampled lighting lights a pixel of several closures:
off, it lights every closure and sums the lights by the closures' weights; on, it picks one closure at
random for each pixel (all equally likely, the blue noise of the pixel and the frame), lights that one
and divides its light by the chance of the pick, the denoiser averaging the picks over the frames.
A pixel of one closure is lit the same either way.

## What the pixel keeps

A view keeps as many closures a pixel as the most any surface its scene wears has (held to
`closuresPerPixel`, or that setting alone where `closureCountFromMaterial` is off). A view whose most
is one closure keeps the single-closure record, byte for byte. A view that keeps several adds, to the
surface record, two colour layers a closure past the first (base colour and metalness, then normal and
roughness) and, to the words, the coverage of every closure and the closure offsets. The words and the normal and
roughness of each closure past the first are cleared each image (a pixel without the closure shows a normal of zero, which no lit surface has); the other colours of a closure
are read where its coverage is not zero. The emission of every
closure, the first too, is weighed by the closure's coverage (and by what the tops above it leave it) before it joins the pixel's emission. A tree that flattens to one closure scaled
by a weight (`weightClosure(slab, 0.3)`) keeps that coverage: the view holds two closures for it (the record keeps the first closure's coverage only when it holds several, so
with `closuresPerPixel` of 1 the weight is lost) and the pixel is lit and emits at its coverage; a weight of one, or no weight, is the plain one-closure graph. A coverage is the
product of the closure's terms from the tree's root: a weight, the foreground share of a mix or the
background's remainder; a closure blended from several slabs is their mix, node by node: a mix
shares by coverage, an add sums the emission, the diffuse albedo and the reflectance at normal incidence
(each slab's base colour, metalness and specular taken to them, summed and held to one, then given back as a base colour,
metalness and specular: exactly for dielectrics, for metals and for a metal and a dielectric of one hue; for other sums, the nearest
three scalars give), and mixes the roughness, occlusion and normal, a weight scales the coverage, a layering weighs the top by its
coverage and the base by what the top leaves uncovered. The slabs carry no mean free path, so a top is an opaque slab: its transmittance is zero, the base shows
only where the top is absent, as the separate closures' light weight does (one minus the top's coverage). The lobes (anisotropy, coat, cloth, subsurface colour) of a blended closure are its
first slab's. The tiles that hold several closures (counted from each pixel's closure offsets word) are
listed after the resolve, one entry for each closure past the first, while a surface of the scene has
several; a view that drops back to one closure gives its tiles back. Each runtime compiles its
surfaces for its own `closuresPerPixel`; a change writes again only the records of surfaces with a
closure tree. A closure past the first keeps, beside its colours, its own flags (the pixel's, with the closure's specular and the mark of a lobe) and the texel of its lobes (what the first closure keeps in the lobes target), in five word layers a closure, after the coverages and before the offsets (a view of one closure holds none). The resolve computes them from the closure's slab, at the closure's own normal, as it does the first closure's; when only a closure past the first has a lobe, the first closure is marked too, with an empty texel, so that the pixel is lit by the programs that hold lobes. The lights, the indirect light, the sampled lighting (summed or picked) and the path tracer's chosen closure read the closure's own specular and lobes; the traced reflections of a closure read its flags and a lobes texture of its own. Not kept per closure: the shading model itself and what it needs beyond the surface (thin transmission, toon data, skin, eye), which are the graph's one output for the pixel (the toon light every closure adds to the toon data is taken by the closure's coverage, the ramp applied once to the sum), and a haze, which the engine has no lobe for. The pixel has one occlusion, its first closure's, as the reference keeps one for the pixel. A material that is hit by a ray
of the path tracer adds the emission of all its closures, weighed by their coverage. Where the view keeps several closures, the hit
also chooses one closure by resampling on their weights (coverage, times the light the layers above leave, times the colour the closure
sends back: its diffuse colour under what its specular lobe keeps, plus that lobe's albedo at the angle of the ray, summed over the
channels), shades the surface as that closure, and multiplies its light by its coverage times the sum of the weights over its own, so that the average over the
samples is the coverage-weighed sum of the closures; the cloth's fuzz, the subsurface colour and the glass share are the hit's, not the closure's, and take no part in the weight.
Where the view keeps one, the hit is shaded as the first closure, and the paths keep the smaller hit record (the fourth word per path is allocated only
for a view of several closures).

Where a view keeps several closures, the sun, the local lights, the per-light draw and the indirect light light each closure
of the pixel and sum them by coverage; a closure past the first is lit from its own slice (base colour, metalness, normal,
roughness), under its own specular and lobes (anisotropy, clear coat, cloth), which the resolve keeps for it (below), and the pixel's shading model, which is the graph's one output for the pixel. The sampled lighting weighs, shades and filters each closure
of the pixel too (summed, or one picked, `stochasticClosureLighting`), and its traces (the screen's and the shadow maps') leave the surface along the normal of the closure the
pixel is lit as (the picked one, the first where the lighting is summed). Its tile classification and its temporal filter read the first closure alone, as the reference's do (it writes its tile
bitmask and its packed pixel data for closure 0 only); the distance field's and the strands' traces go on from where the screen's left the ray. The screen probes place and trace
their probes for the first closure, as the reference does, and light the pixels of every closure from them: for each closure past the first the short-range occlusion and the
integration of the probes run over the tiles that hold the closure (the overflow tiles the material pass lists, one region of the list for each closure), not over the view, and the temporal
history runs over the view with the closure's own history, as the reference dispatches it; the indirect light of a closure reads its own irradiance and rough
specular light (a view of several closures keeps, once more for each closure past the first, the history and the textures of the occlusion and of the integration). Where the
integration's tiles are not classified (`screenProbeIntegrationTileClassification` off) every closure's integration is over the view, as the reference's. The traced reflections trace each closure past the first as the first:
a pixel's flags are kept for the closure (written over the closure's overflow tiles), its rays are drawn from the normal and roughness of the closure, and they are traced, accumulated and
resolved into two layers of the reflection target of its own (the target holds two layers a closure), which the lit passes read for the closure they light; the specular and the lobes of
the closure (a clear coat, a skew, a cloth) are its own, as in the lights: the flags kernel writes them beside the closure's flags. A closure past the first has its own rays, hits and history; the view, the depth, the lit image, the front layer
and the kept depth are shared. Its tiles are classified over the overflow tiles of the closure, not over the grid: each overflow tile marks the tracing tile that holds it, the marked tiles are
listed, and the classification runs over that list; a tile that holds no pixel of the closure is traced, resolved and cleared by nothing. Its scene stage is the first closure's: the meshes' fields
stage, the radiance cache's limits and reads, the trace through the scene's triangles and the hit lighting run for it over its own lists, as for the first. The front layer and the water are one closure
in the reference, so their reflections are not traced a second time; the planar reflection is computed once for the top layer of the pixel; all three stay the first closure's. The front layer resolves into pixels
of its own, so that the accumulation of the opaque surface reads its own. Until the layers of a closure past the first were written by a trace once, they hold the first closure's, so that no
image shows the closure black. The tiles the closure's overflow tiles are in may hold history from an image where they were not traced. The attenuation of a layer's base by its
top is applied when the base is lit, never to its stored coverage: the resolve stores beside the coverage the luminance weight the tops leave the base (one minus each top's coverage, a slab being opaque, squared for the view's and the light's way), and the readers weigh the closure's light by both. The top-layer data weight is not kept. A view of one closure runs the
same passes as ever.

## The pixel's own count, and the limits

Every closure loop of a pixel (the sun, the local lights, the per-light draw, the indirect light, the sampled lighting summed, the reflection read of the lit passes) runs over the closures that pixel itself has, as the reference loops the BSDF count of the pixel's header, not over the closures the record holds. The count is read from the pixel's closure offsets word: one for the first closure, then one more up to the last step that is not zero, never more than the record holds. A pixel of one closure, or of a record that holds one, runs the loop once; a pixel without the later closures is not read for them, so an absent closure (a zeroed normal) adds neither light nor NaN, and a pass costs what the pixel holds, not what the view keeps. The resolve writes the offsets of a pixel for its material's closure count held to the closures the record holds, and the tile kernel counts at most what the record holds.

Limits, all of them:

| Limit                                       | Value                                                                                                                                                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| closures a pixel keeps (`closuresPerPixel`) | 1 to 8, 4 by default; the offsets word packs eight, four bits each                                                                                                                                                                                       |
| operators of a closure tree once simplified | 15                                                                                                                                                                                                                                                       |
| tile of the closure lists                   | 8 by 8 pixels; a tile's coordinates take 12 bits, so a frame lists its overflow tiles up to 4096 tiles a side (32768 pixels)                                                                                                                             |
| a frame wider or taller than that           | lists no closure tile: the closures past the first of such a frame get no screen-probe integration and no traced reflection of their own, though the lights still light every closure the pixel has (a device's largest texture is below it in practice) |
| a tile entry                                | the tile's two coordinates (twelve bits each), the closure's number and the most closures any pixel of the tile has (four bits each)                                                                                                                     |

The most is counted once an image, from the census (a closure tree set between two images is read by the next one). The most closures a view keeps follows the census of the surfaces in view and the sum of the graphs' shapes: a graph whose closure tree is set again changes its shape, so the view's count and the record's layers follow in the same image, never one image late. A view whose most is one closure holds no closure layer, no closure list and runs no closure pass, though the record holds several (`closureCountFromMaterial` off): the traced reflections' closure flags, classification and layer copies and the screen probes' passes per closure past the first are bounded by that most, not by what the record holds.
