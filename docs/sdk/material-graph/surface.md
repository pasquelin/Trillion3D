# A surface that wears a graph

The opaque resolve and transparent pass read the graph's outputs, not the material's colour,
`metalness`, `roughness`, `emissive`, maps, lobes or thin transmission; unwired outputs take their
default (table in "Outputs by domain"), never the material's value. The material still decides
`side`, `transparent`, `blending`, `alphaTest`, `depthWrite`, family (`meshStandard`,
`meshPhysical`, `meshBasic`…) and lit or unlit model. Outputs are clamped: `baseColor`, `metallic`, `roughness`,
`ambientOcclusion`, `specular`, `opacity`, `subsurfaceColor` to 0..1, `emissive` to at least 0 (see
`allowNegativeEmissive`). `normal` is tangent space.

**An unlit surface draws through `emissive`.** An unlit family (`meshBasic`…) reads `emissive`
(its colour), `opacity`, its mask and `worldPositionOffset` only.

```js
import { material, Texture } from 'trillion3d'

// A glass that ripples: translucent, its colour and opacity from a panned map, its roughness from the time.
const g = material.graph('surface')
const waves = g.textureSample(new Texture(waveImage), {
  uv: g.panner({ speed: [0.03, 0.01], coordinate: g.texCoord(0, 4, 4) }),
})
g.output(
  'baseColor',
  g.multiply(g.channel(waves, 'rgb'), g.vectorParameter('tint', [0.6, 0.8, 1, 1])),
)
g.output('opacity', g.multiply(g.channel(waves, 'a'), 0.7))
g.output('roughness', g.add(0.1, g.multiply(g.sine(g.time(), 4), 0.05)))
g.output('specular', g.constant(0.9)) // a brighter highlight than the default 0.5 gives
mesh.material = material.meshStandard({ transparent: true, graph: g })
g.set('tint', [1, 0.7, 0.5]) // the next image: only a value is written, nothing compiles again
```

- **`allowNegativeEmissive`.** Material option, `false` by default: `emissive` may take light away
  only if `true`: `material.meshStandard({ allowNegativeEmissive: true, graph })`.
- **Specular.** A dielectric reflects `0.08 × specular` at normal incidence (`0.04` at 0.5); a metal
  its colour (stored in surface flags, step 1/254). A clear coat keeps its own 0.04
  (`'layered'`) or adds `0.04 × weight` (`'single'`).
- **Anisotropy.** `a` -1 to 1 (`tangent`: direction, tangent space): highlight `α(1 + a)` wide
  along the tangent, `α(1 − a)` across, `α` the roughness squared; negative `a`: bitangent is the
  long axis. The material's `anisotropy` gives the same widths.
- **Refraction.** `refraction` on a translucent surface that transmits
  (`meshPhysical({ transmission: 1, transparent: true })`) is the index of refraction: 1 (default)
  bends nothing, 0 means the material's `ior`; it beats `ior`. Only the index is read of the
  reference's three refraction modes.
- **`normalCurvatureToRoughness`** (boolean, `false`): roughness raised to at least
  `saturate(max(dN/dx·dN/dx, dN/dy·dN/dy)^0.333)` from the vertex normal (not the normal map); a
  clear coat's likewise. `world.shading` fields (also `createWorld` options):
  `normalCurvatureScale` (`1`, held to [0, 2]), `normalCurvatureBias` (`0`, [-1, 1]),
  `normalCurvatureExponent` (`0.333`, [0.05, 20]):
  `world.shading = { normalCurvatureExponent: 0.5 }`;
  `new Material('meshStandard', { roughness: 0.2, normalCurvatureToRoughness: true })`.
