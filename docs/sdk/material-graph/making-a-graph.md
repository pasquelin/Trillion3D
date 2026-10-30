# Making and wearing a graph

```js
import { material, light, Texture } from 'trillion3d'

const g = material.graph('lightFunction') // 'surface' | 'lightFunction' | 'volume'
const clouds = g.textureSample(new Texture(cloudImage), { uv: g.panner({ speed: [0.02, 0] }) })
const tint = g.vectorParameter('tint', [1, 0.9, 0.7, 1]) // named, given values with g.set
g.output('emissive', g.multiply(g.channel(clouds, 'rgb'), g.channel(tint, 'rgb')))

lamp.lightFunction = material.lightFunction({ graph: g }) // the light shines through moving clouds
g.set('tint', [1, 0.5, 0.2]) // the next image
```

A material wears a graph of its own domain (`material.lightFunction({ graph })`,
`material.volume({ graph })`, any other member for `'surface'`); another domain is refused
(`INVALID_MATERIAL`). The graph is heard like a texture: a write to it, to a texture it reads, or to
a parameter (`g.set(name, value)`) repaints what wears it. `material.clone()` clones the graph. A
saved world stores the graph with the material and reads it back, except a graph that holds a
texture, refused like a material that holds one (`SCENE_NOT_SAVABLE`).
