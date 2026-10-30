# Material graph

A material can compute its outputs from a graph: nodes wired into the outputs its domain reads,
compiled to the shader that evaluates them. `material.graph(domain)` makes an empty one; each call
on it adds a node and returns the wire of its output; `output(name, wire)` plugs a wire into an
output.

- [Making and wearing a graph](material-graph/making-a-graph.md)
- [Outputs and types](material-graph/outputs-and-types.md)
- [Nodes](material-graph/nodes.md)
- [A surface that wears a graph](material-graph/surface.md)
- [Opacity mask](material-graph/opacity-mask.md)
- [World position offset and object switches](material-graph/world-position-offset.md)
- [Shading model per pixel](material-graph/shading-model.md)
- [Pixel depth offset and displacement](material-graph/depth-and-displacement.md)
- [Thin translucent](material-graph/thin-translucent.md)
- [Volume and light function domains](material-graph/volume-and-light-function.md)
- [Closures: several layers per pixel](material-graph/closures.md)
- [Compile failures and late joins](material-graph/refusals.md)
