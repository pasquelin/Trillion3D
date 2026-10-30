# Outputs and compile

**The outputs** (`graph/outputs.ts`): twenty-seven, with type and default: `baseColor` float3 0 0 0,
`metallic` 0, `specular` 0.5, `roughness` 0.5, `emissive` float3 0, `opacity` 1, `opacityMask` 1,
`normal` float3 0 0 1, `ambientOcclusion` 1, `subsurfaceColor` float3 1 1 1, `anisotropy` 0,
`tangent` float3 1 0 0, `clearCoat` 1, `clearCoatRoughness` 0.1, `refraction` 1,
`worldPositionOffset` float3 0, `shadingModel` 1, `pixelDepthOffset` 0, `cloth` 0, `displacement`
0.5, `clearCoatBottomNormal` float3 0 0 1.

- Water: `scatteringCoefficients` float3 0, `absorptionCoefficients` float3 0, `phaseG` 0,
  `colorScaleBehindWater` float3 1. A surface whose graph wires one is single-layer water
  (`isWaterGraph`); `opacity` is its base material's coverage; reads `refraction`.
- Thin translucent: `transmittanceColor` float3 0.5, `surfaceCoverage` 1. A lit surface whose graph
  wires one is thin translucent (`isThinTranslucentGraph`): `opacity` is its lit layer's coverage.
- A translucent surface reads `pixelDepthOffset` too.

A domain lists what it reads (`DOMAIN_OUTPUTS`):

- Surface: all (`outputActive`, by `alphaModeOf`: opacity only when it blends, mask only when masked,
  refraction only where the transparent pass draws it; unlit reads only `emissive`, opacity or mask,
  `worldPositionOffset`).
- Light function: `emissive`. Volume: `baseColor` (albedo), `subsurfaceColor` (extinction),
  `emissive`.
- An output not read, or inactive, takes its default and is not compiled. A lobe (`anisotropy`,
  `clearCoat`) is on where its output is wired.

**The compile** (`materials/graph/compile.ts`) translates each wired output into WGSL `let` lines,
one function `mg<Output>(ctx: MgContext, g: MgValues)` each. A node is translated once
(`State.value` memoises by node), its component mask applied.

- Value types: `flex` (scalar constant, any width), `f1` to `f4`, `texture` (`graph/valueType.ts`).
  A scalar with a vector repeats (`splat`); vectors of different widths are refused; a cast
  (`value.ts`) may repeat a scalar, cut components or fill with zeros where the use allows.
- Constants fold (`arith.ts`, `vector.ts`, `choose.ts`): zero or one factors, equal or
  constant-alpha `lerp`, a power of 0 or 1, a base 0, a choice between constants; a function of a
  constant with no finite value is refused. An output is cast to its type (`forceCast`).
- A divisor every pixel shares (`Emitter.uniform`) is held to at least 1e-5 in magnitude (`divide`,
  `fmod`); `normalize` holds squared length to 1e-10; `round` goes up at a half.
- Noise: one block (`noiseWgsl.ts`), included when the graph calls `mgNoise` (`Uses.noise`).
  Vertex colour (`Uses.colour`, read from `MgContext.vertexColor`) is not filled by any pass: a
  graph reading it is refused
  (`CompileOptions.vertexColor`). Errors are `INVALID_MATERIAL` with the node.

**The values** a compiled function reads are one uniform `MgValues`: `v`, a `vec4f` per parameter
name (a scalar reads `.x`), then `t`, the colour-atlas slot of each texture, four to a `vec4u`
(`materials/graph/layout.ts`, `Slots`). `Slots.fill(graph, buffer, offset, slotOf)` writes them;
false while a texture has no slot yet. A texture parameter `name` is one slot, replaced by the
texture `graph.set(name, texture)` gives. `MgContext`: eight texture coordinate sets, world position,
eye, object position, vertex and pixel normals, time (game's and real). A texture read's footprint
is the context at the pixels beside (`mgNeighbour`).

**Textures** are read through the colour atlas (`colorSample`, `materials/virtual/wgsl.ts`), `mipMode`
`none`: footprint from `dpdx`/`dpdy` (`derivatives: 'screen'`) or the context's `ddx`/`ddy`
(`'context'`); `bias` scales it by `exp2(bias)`; `level` uses a one-texel footprint of the level
(`mgSampleLevel`).

**Light functions** (`lighting/lightFunction/graphSlot.ts`) compile the graph for the atlas
(`compileGraph`, screen derivatives) once per material version: `mgEmissive` is the slot's colour,
black where `emissive` is not wired; slot parameters are a 16-byte head (the time twice) then
`MgValues`. Programs are keyed by the graph's text (`SlotPrograms`, `slotPrograms.ts`). A slot is
redrawn when the material or a texture changes, and each image when the graph reads the time
(`GraphSlot.animated`; `LightFunctionAtlas.waiting` and `changes` follow). A refused graph names
`light-function-graph-refused` once and the slot is
drawn from the material's parameters. World position, camera and normal nodes are refused; object
position is zero.
