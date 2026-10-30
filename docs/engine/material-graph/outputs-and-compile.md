# Outputs and compile

**The outputs** (`graph/outputs.ts`): twenty-seven, with type and default: `baseColor` float3 0 0 0,
`metallic` 0, `specular` 0.5, `roughness` 0.5, `emissive` float3 0, `opacity` 1, `opacityMask` 1,
`normal` float3 0 0 1, `ambientOcclusion` 1, `subsurfaceColor` float3 1 1 1, `anisotropy` 0,
`tangent` float3 1 0 0, `clearCoat` 1, `clearCoatRoughness` 0.1, `refraction` 1,
`worldPositionOffset` float3 0, `shadingModel` 1, `pixelDepthOffset` 0, `cloth` 0, `displacement`
0.5, `clearCoatBottomNormal` float3 0 0 1; water: `scatteringCoefficients` float3 0,
`absorptionCoefficients` float3 0, `phaseG` 0, `colorScaleBehindWater` float3 1 (a surface whose
graph wires one is single-layer water, `isWaterGraph`, reading `opacity` as its base material's
coverage, and `refraction`); thin translucent: `transmittanceColor` float3 0.5, `surfaceCoverage` 1
(a lit surface whose graph wires one is thin translucent, `isThinTranslucentGraph`: its record
transmits, `opacity` is its lit layer's coverage). A translucent surface reads `pixelDepthOffset`
too, for the depth of its responsiveness mark.

A domain lists what it reads (`DOMAIN_OUTPUTS`): a surface all of them (`outputActive`, by
`alphaModeOf`: the opacity only when it blends, the mask only when masked, the refraction only where
the transparent pass draws it; an unlit surface reads only `emissive`, the opacity or mask and
`worldPositionOffset`); a light function `emissive`; a volume `baseColor` (albedo), `subsurfaceColor`
(extinction), `emissive`. An output a domain does not read, or an inactive one, takes its default and
is not compiled. A lobe (`anisotropy`, `clearCoat`) is on where its output is wired.

**The compile** (`materials/graph/compile.ts`) translates each wired output's wire into WGSL `let`
lines, one function `mg<Output>(ctx: MgContext, g: MgValues)` each. A node is translated once
(`State.value` memoises by node), its output's component mask applied. Values are typed `flex` (a
scalar written as a constant, fits any width), `f1` to `f4` and `texture` (`graph/valueType.ts`). A
scalar with a vector repeats the scalar (`splat`); two vectors of different widths are refused; a
cast (`value.ts`) may repeat a scalar, cut components or fill with zeros only where the use allows.
A constant stays a literal and folds through the operation (`arith.ts`, `vector.ts`, `choose.ts`):
zero or one factors, equal or constant-alpha `lerp`, a power of 0 or 1, a base 0, a choice between
constants; a function of a constant with no finite value is refused (no shader literal holds it).
An output's result is cast to its type (`forceCast`).

The emitter knows which values every pixel shares (`Emitter.uniform`: a constant, a parameter slot,
a local computed from these alone); nodes whose result depends on it ask. Such a divisor is held to
at least 1e-5 in magnitude (`divide`, `fmod`; a varying dividend is multiplied by the floored
divisor's reciprocal, one local for all pixels); `normalize` scales by the reciprocal root of the
squared length held to 1e-10 (a zero vector stays zero); `round` goes up at a half. The noise
functions are one block (`noiseWgsl.ts`) listed by a program whose graph calls `mgNoise`
(`Uses.noise`). The vertex colour (`Uses.colour`) is read from `MgContext.vertexColor`, which no pass
fills yet, so a graph reading it is refused (`CompileOptions.vertexColor`). Errors are
`INVALID_MATERIAL` with the node.

**The values** a compiled function reads are one uniform `MgValues`: `v`, a `vec4f` per parameter
name (a scalar reads `.x`), then `t`, the colour-atlas slot of each texture, four to a `vec4u`
(`materials/graph/layout.ts`, `Slots`). `Slots.fill(graph, buffer, offset, slotOf)` writes them from
the graph's values; false while a texture has no slot yet. A texture parameter `name` is one slot,
replaced by the texture `graph.set(name, texture)` gives. The host's context `MgContext`: eight
texture coordinate sets, world position, eye, object position, vertex and pixel normals, time (the
game's and the real one). A texture read's footprint is the context evaluated at the pixels beside
(`mgNeighbour`).

**Textures** are read through the colour atlas (`colorSample`, `materials/virtual/wgsl.ts`) at the
sample's coordinate, `mipMode` `none` with the coordinate's footprint: `dpdx`/`dpdy` for a program
whose pixels are neighbours (`derivatives: 'screen'`), the context's `ddx`/`ddy` for one without
(`'context'`); `bias` scales that footprint by `exp2(bias)`; `level` uses a footprint of one texel of
the level (`mgSampleLevel`).

**Light functions** (`lighting/lightFunction/graphSlot.ts`) compile the material's graph for the
atlas (`compileGraph`, screen derivatives) once per material version: `mgEmissive` is the slot's
colour, black where `emissive` is not wired; the slot's parameters are a 16-byte head (the time
twice) then `MgValues`. The program is keyed by the graph's text (`SlotPrograms`, `slotPrograms.ts`),
the slot's group bound at the size it reads. A slot is redrawn when the material or a texture
changes, while a texture is not read at the detail the slot shows, and each image when the graph
reads the time (`GraphSlot.animated`; `LightFunctionAtlas.waiting` and `changes` follow). A graph the
compile refuses names `light-function-graph-refused` once and the slot is drawn from the material's
parameters. The atlas cannot give a world position, camera or normal: those nodes are refused at
compile, and the object's position is zero.

