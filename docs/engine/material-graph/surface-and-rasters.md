# The surface and the rasters

**The surface** (`materials/graph/surfaceProgram.ts`, `surfaceClasses.ts`, `kept.ts`,
`table/graphRecord.ts`, `visibility/shader/shadeGraphWgsl.ts`). A surface wearing a graph
(`PageSurface.graph`, carried by the families that draw the material's colour: `GRAPH_FAMILIES`) has
its program compiled once per graph shape (`compileKept`, `graph.shape`; a value written to a
parameter compiles nothing). One compile gives everything: the text with no suffix is the program's
identity (`CompiledGraph.key`, whole, so no hash collision merges two programs), its 64-bit hash
names it, and the transparent pass's declarations are named by it (`named`). A program is known by
that text plus whether the surface is lit (an unlit surface compiles emission, opacity, mask and
offset alone: `outputActive`) and whether its emission may be negative (`allowNegativeEmissive`);
surfaces whose graphs compile alike share a program, each with its own values.

A program is a resolve class of its own: its key is one of the `GRAPH_CLASS_KEYS` (256) past the
features' (`MATERIAL_CLASS_KEYS`), over the features its rows are worn on (`graphClassKey`;
`CLASS_KEY` holds the features, `CLASS_BIN` the bin), so every class of a program shares one module
(`shadePipelines.ts`, `graphModule`). The census of worn surfaces (`shadeCensus.ts`) gives the
classes in use at each retake (`releaseGraphClasses`): a class no surface needs frees its key after
two censuses, and a pipeline is made for the class a key stands for now (`classIdentity`,
`ShadeClasses.prune`), so a session editing graphs endlessly never runs out of keys; one wearing more
at once than there are keys draws the surfaces past them from their parameters and names it. Such a
row reads none of its maps or vertex colours (`wearGraph`): the graph computes them.

The values are a header texel with the program's id and bits (`GRAPH_HEADER`: `mask` when the graph
wires an `opacityMask`, `blend` for a transparent pass's program, whose ids count from one as the
resolve's do), then the parameters' vectors and each texture's colour-atlas slot (`Slots.fill`). They
are written in the material table beside the surface's record, in a block of record places the
surface owns (`graphRecord.ts`; the record's `graph` word names its first texel plus one; the header
is read by `materialGraphHead`). The record holds neutral factors and no map slot
(`writeMaterialRecord`: no material factor reaches a pass), its lobe extension zeros
(`writeLobeRecord`). The resolve reads the values with the table's own binding (`graphLoadWgsl`): no
binding, pass or program for a surface without a graph.

The resolve evaluates the graph at the pixel in `shadeSurface` (the splices of `ShadeGraph`):
- the context (`MgContext`: the page's eight UV sets, the world position at the pixel's weights, the
  camera in `ShadeUni.eye`, the object's origin, vertex and pixel normals, the graph frame's clocks);
- each texture read's footprint, from the same context a pixel to the right and a pixel below
  (`mgNeighbour`: the coordinate sets plus derivatives, the world position at the next pixels'
  weights, `bx`/`by` declared once);
- the normal and outputs after the vertex normal is known (`heldOutputs`: one rule for resolve and
  transparent pass), the diagnostic views' colours, the thin transmission and the specular
  (`specularFlag`, the surface flags' second byte: `surfaceSpecular`, `surfaceF0`).

The lobes the graph wires are set in the pixel's lobe record (`graphLobes`: strength, axis law,
tangent, coat) before the record's own call stores them: one lobe construction for material and
graph. The lighting gives every anisotropy, a material's or a graph's, the widths α(1 + a) along and
α(1 − a) across (`lobeAxis`, `lobeAcross`). The textures' tile requests replace the maps' (`mgAsk`
re-evaluates the coordinate of the read the pixel's pick names). A graph's textures join the colour
atlas with the materials' (`collectWebgpuMaterialTextures`); a graph reading the time keeps the frame
drawing (`vis.graphsAnimated`, `blendGraphsAnimated`).

**The graph frame** (`visibility/shader/graphFrameWgsl.ts`, `frame/render/graphFrame.ts`). What a
raster reads of the image to evaluate a graph's cutout and offset is one small uniform (48 bytes) for
every pass that places a vertex or cuts a pixel (visibility rasters and binning, dicing, the
tessellation's seeding and splitting, shadow depth passes, resolves, temporal pass, transparent
pass): the clocks of the image and of the one before (world time and wall clock), the camera and the
one before, and in the camera's fourth float whether the blue noise a dithered cutout is cut by is
bound, then the view's image number that noise is walked by (`GraphFrame.frame`, the view's
`stochasticPhase`). It is written once per image (`resetFrameCounters`) and bound at the number each
layout gives it (`VIS_BINDINGS.frame`, `SHADE_BINDINGS.frame`, `BLEND_BINDINGS.frame`,
`TESS_BINDINGS.frame`, the velocity stage's). The clocks a graph reads are one value in all of them;
no material-table value is rewritten to follow an image.

**The graph outputs the rasters evaluate** (`materials/graph/outputProgram.ts`, `maskProgram.ts`,
`wpoProgram.ts`, `graphRasters.ts`). One registry (`rasterRegistry`) builds, per program of a surface
graph, the program restricted to one output, the cutout (`opacityMask`, `maskOf`) or the offset
(`worldPositionOffset`, `wpoOf`), with the resolve's values and layout. The rules each output keeps
(texture sets named, whether it reads a texture and the device lets its stage) decide what the
rasters refuse, through `refuseGraph`.

`GraphRasters` is the sorted list of those programs the session's surfaces wear (`graphRastersOf`),
held in `WebgpuVisState.rasters` from its open (`holdGraphRasters`, before the first module is made)
and read by every module that evaluates them: `cameraMasks`, `shadowMasks`, `diceMasks` for cutouts;
`visibilityWpo`, `voxelWpo`, `tessellationWpo`, `diceWpo`, `shadowWpo`, `shadowSplitWpo`,
`patchVertexWpo`, `shadeWpo`, `blendWpo` and `velocityWpo` for offsets, each naming the bindings its
module reads them at. A module made with none is word for word the one without.
`GraphRasters.textures` is the device's answer to whether a vertex stage may read the colour atlas
(`grantsVertexTextures`: ten storage buffers, the fullest vertex stage binding that many with it).

A graph joining the session later is taken at the frame entry that retakes the census
(`followGraphRasters`, `frame/prepare/lateGraphs.ts`): the set is extended, the visibility module and
pipelines are remade, the software raster follows (`ensureGpuRaster`), the shadow maps' rasters and
tessellation follow the set they are handed (`vsmRenderContext` compares it), and where an offset
joined the temporal pass is remade (`rigTemporalAgain`, history restarted), compiled off the thread
under a held frame (`track`, `deviceAnswering`), the previous image shown, the session not reopened.
The transparent pass takes the set when it builds its programs for the copies a session gains
(`growth.ts`).

