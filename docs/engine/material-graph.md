# Material graph

A material of any domain may wear a graph (`world/material/graph/`, authored in
[docs/SDK.md](../sdk/material-graph.md#material-graph)): nodes wired into the outputs its domain
reads, compiled by `materials/graph/` to one WGSL function per output. The graph is data: a
`GraphStore` of nodes (`id`, `kind`, `props`, `inputs`: a wire is a node and one of its outputs),
the outputs' wires, the textures of its texture nodes and the values written to its parameters. A
wire may only name a node already added: no cycle, nodes in compile order. It is a `Material` field
(`graph`), heard like a texture (`Material.assignGraph`), cloned with the material, saved as
`GraphData` by `toJSON` (a graph holding a texture is `SCENE_NOT_SAVABLE`), checked at assignment
against the material's domain.

Parts:

- [Outputs and compile](material-graph/outputs-and-compile.md): outputs, the compile, values, textures, light functions
- [The surface and the rasters](material-graph/surface-and-rasters.md): the surface program, the graph frame, outputs the rasters evaluate
- [Transparent pass, volume, mask and pixel programs](material-graph/transparent-volume-and-mask.md)
- [Shading models](material-graph/shading-models.md): per pixel, without a graph, GGX energy table, skin, profile, hair, eye
- [Toon shading](material-graph/toon-shading.md)
- [Single-layer water](material-graph/single-layer-water.md)
- [World position offset](material-graph/world-position-offset.md)
