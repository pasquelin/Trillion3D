# A surface that wears a graph

The opaque resolve and the transparent pass read the outputs of the graph in place of the
material's colour, `metalness`, `roughness`, `emissive`, normal map, occlusion map, lobes, thin
transmission and other maps; an output that is not wired takes its default (the table in "Outputs
by domain"), never the material's value. The material still decides how the surface is drawn:
`side`, `transparent`, `blending`, `alphaTest`, `depthWrite`, its family (`meshStandard`,
`meshPhysical`, `meshBasic`…) and its lit or unlit model. Outputs are held to their range as a
shader holds them: `baseColor`, `metallic`, `roughness`, `ambientOcclusion`, `specular` and
`opacity` from 0 to 1, `emissive` not below 0 (see `allowNegativeEmissive`), the thin transmission
`subsurfaceColor` from 0 to 1. `normal` is in tangent space and bends the vertex normal in the frame
the normal maps use; a surface has no `normal` map of its own while it wears a graph. The material's
record holds neutral factors for such a surface: its `opacity`, `subsurfaceColor` and maps leak
nowhere.

**An unlit surface draws through `emissive`.** A material of an unlit family (`meshBasic`…) reads
the `emissive` output as its colour, its `opacity`, its mask and its `worldPositionOffset`: its
other outputs are not read and take their defaults, whatever is wired to them.

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

- **`allowNegativeEmissive`.** A material option, `false` by default: the `emissive` output may take
  light away only where it is `true`, as in `material.meshStandard({ allowNegativeEmissive: true, graph })`.
  It is saved with the world and is part of what decides the surface's program.
- **Specular.** A dielectric reflects `0.08 × specular` at normal incidence, `0.04` at the default
  0.5, the value of every surface that gives none; a metal reflects its colour. The opaque resolve
  leaves the pixel's specular in its surface flags (a step of 1/254); the lights, the reflections'
  weight and the transparent pass read it. A clear coat keeps its own 0.04 (`'layered'`), or adds
  `0.04 × its weight` to the reflectance (`'single'`).
- **Anisotropy.** The graph's `anisotropy` `a`, from -1 to 1 (`tangent` the direction of the
  stretch, in tangent space, carried whole to the world and kept orthogonal to the final normal),
  makes the highlight `α(1 + a)` wide along the tangent and `α(1 − a)` across it, `α` the square of
  the roughness; where `a` is negative the long axis is the bitangent. A material's own `anisotropy`
  gives the same widths. Under a clear coat the base keeps its anisotropy, in the coat's context.
- **Refraction.** The `refraction` output of a translucent surface that transmits
  (`meshPhysical({ transmission: 1, transparent: true })`) is the index of refraction its fragments
  bend what lies behind by; 1, the default, bends nothing, and 0 says none: the material's own
  applies. A graph that wires it wins over the `ior` the material declares. Of the reference's three
  refraction modes only the index of refraction is read; the pixel-normal strength, the
  two-dimensional offset and the refraction depth bias are not offered.
- **`normalCurvatureToRoughness`** (boolean, `false` by default): the material's roughness is raised
  to at least the one given by the change of its vertex normal across one pixel:
  `saturate(max(dN/dx·dN/dx, dN/dy·dN/dy)^0.333)`, so a curved surface far away reads rougher and
  its highlight does not flicker. It reads the interpolated vertex normal, never the normal map, and
  costs no extra texture read; a flat face is unchanged. A clear coat's roughness is raised the same
  way. The curve is set by the `world.shading` fields `normalCurvatureScale` (`1`, any number, held
  to [0, 2] where read), `normalCurvatureBias` (`0`, any number, held to [-1, 1] where read) and
  `normalCurvatureExponent` (`0.333`, any number, held to [0.05, 20] where read), each an option of
  `createWorld` too: `world.shading = { normalCurvatureExponent: 0.5 }`. Example:
  `new Material('meshStandard', { roughness: 0.2, normalCurvatureToRoughness: true })`.
