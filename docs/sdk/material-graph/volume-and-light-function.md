# Volume and light function domains

## A graph in the volume domain

An object of the fog's volume (a mesh that wears `material.volume({ graph })`, or
`addFogVolume({ id, graph })`) takes its albedo from `baseColor` (from 0 to 1), its extinction from
the red channel of `subsurfaceColor` (from 0 to 65 000 per metre) and its emissive light from
`emissive`, evaluated at the centre of each cell it covers, in place of its `albedo`, `extinction`
and `emissive`. Its context is the world position of the cell, the camera, the object's position
and the time; there is no texture coordinate and no normal. The volume domain has no
`ambientOcclusion` output: wiring it is refused. An unwired `subsurfaceColor` is 1: wire it, or the
object adds one per metre.

```js
import { material, Texture } from 'trillion3d'

// Smoke that thins with height and drifts: a density from a noise map read at the world position.
const g = material.graph('volume')
const noise = g.textureSample(new Texture(noiseImage), {
  uv: g.panner({ speed: [0.02, 0], coordinate: g.componentMask(g.worldPosition(), 'rg') }),
})
const density = g.multiply(g.channel(noise, 'r'), g.scalarParameter('density', 0.8))
g.output('baseColor', g.constant(0.7, 0.7, 0.75))
g.output('subsurfaceColor', g.appendVector(density, g.constant(0, 0)))
g.output('emissive', g.constant(0, 0, 0))
scene.add(new Mesh(box, material.volume({ graph: g })))
```

A texture a volume graph reads is taken into the colour atlas and asked at its full detail: keep
them small (a noise of 128 to 512 texels). A graph that does not compile adds what its material
gives.

## A light function material on a mesh

`material.lightFunction()` draws into the light function atlas alone. A mesh that wears one is drawn
with the default material (white, unlit): it raises no error.
