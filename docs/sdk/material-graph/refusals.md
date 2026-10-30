# Compile failures and late joins

- A graph that does not compile (a missing required input, a type error, a node the domain has no
  value for) raises `INVALID_MATERIAL` naming the node.
- A light function whose graph is refused is drawn from its parameters, as one with no graph is, and
  the engine names the refusal once (`light-function-graph-refused`).
- **A graph the pass refuses** (a node or output it cannot compile) is named once
  (`material-graph-refused`) and the surface is drawn from the material's parameters. A scene wears
  at most 256 programs of the opaque resolve at once, each over its geometry's attributes (a program
  no surface wears gives its place back): past them a surface is drawn from its parameters and the
  engine says so.
- **A pipeline the device refuses to compile** is named once per pipeline (`pipeline-refused`, with
  the pipelines it names): the pass that needs it is left out of the image, which stays as drawn
  without it. For a pipeline still in use, the engine asks the device again after a wait that starts
  at 4 seconds and doubles at each refusal in a row (up to about 4 minutes, each wait spread by a
  quarter either way); a refusal that cannot pass (the shader or its layout is wrong, the device was
  lost) is not tried again.
- **A graph that joins a running world** (a material assigned, a node, an output or a texture
  written into a graph a material wears) makes its surfaces wear another program. The engine
  compiles it while the frame waits, showing the previous image, and does not open the session
  again; the cutouts and offsets the rasters evaluate join the modules that hold them the same way,
  and the engine says so once (`material-graph-rasters-late`). A value written with `g.set` writes
  the values alone: nothing compiles. When an offset joins, the temporal anti-aliasing starts its
  history again.
