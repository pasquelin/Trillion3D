# The surface and the rasters

**The surface** (`materials/graph/surfaceProgram.ts`, `surfaceClasses.ts`, `kept.ts`,
`table/graphRecord.ts`, `visibility/shader/shadeGraphWgsl.ts`). A surface wearing a graph
(`PageSurface.graph`, on the `GRAPH_FAMILIES`) has its program compiled once per graph shape
(`compileKept`, `graph.shape`; writing a parameter value compiles nothing). A program is keyed by
its text (`CompiledGraph.key`), whether the surface is lit (unlit compiles emission, opacity,
mask and
offset alone: `outputActive`) and whether emission may be negative (`allowNegativeEmissive`);
surfaces compiling alike share a program, each with its own values.

A program is a resolve class: its key is one of the `GRAPH_CLASS_KEYS` (256) past the features'
(`MATERIAL_CLASS_KEYS`), over the features its rows are worn on (`graphClassKey`; `CLASS_KEY`
features, `CLASS_BIN` bin); a program's
classes share one module (`shadePipelines.ts`, `graphModule`). The census of worn surfaces
(`shadeCensus.ts`) gives the classes in use at each retake; a class no surface needs frees its key
after two censuses (`releaseGraphClasses`; a pipeline is made for the class a key stands for now:
`classIdentity`, `ShadeClasses.prune`). Surfaces past the keys are drawn from their
parameters (the session names it), reading none of their maps or vertex colours (`wearGraph`).

The values are a header texel with the program's id and bits (`GRAPH_HEADER`: `mask` when the graph
wires an `opacityMask`, `blend` for a transparent pass's program), then the parameters' vectors
and each texture's colour-atlas slot (`Slots.fill`), in a block of material-table record places the surface owns
(`graphRecord.ts`; the record's `graph` word is its first texel plus one; header read by
`materialGraphHead`). The record holds neutral factors, no map slot
(`writeMaterialRecord`) and a zero lobe extension (`writeLobeRecord`); values are read by
`graphLoadWgsl`.

The resolve evaluates the graph at the pixel in `shadeSurface` (`ShadeGraph`):

- the context (`MgContext`: the page's eight UV sets, world position, camera in `ShadeUni.eye`,
  object
  origin, vertex and pixel normals, the graph frame's clocks);
- each texture read's footprint, from the context a pixel right and below (`mgNeighbour`; `bx`/`by` declared once);
- the normal and outputs after the vertex normal (`heldOutputs`, shared with the transparent pass),
  the diagnostic views' colours, the thin transmission and the specular (`specularFlag`, the
  surface flags' second byte: `surfaceSpecular`, `surfaceF0`).

The graph's lobes are set in the pixel's lobe record (`graphLobes`: strength, axis law, tangent,
coat); anisotropy a gives widths α(1 + a) along and α(1 − a) across (`lobeAxis`, `lobeAcross`). Tile
requests replace the maps' (`mgAsk`); a graph's textures join the colour atlas
(`collectWebgpuMaterialTextures`). A graph reading the time
keeps the frame drawing (`vis.graphsAnimated`, `blendGraphsAnimated`). A program's transparent declarations are named by its hash (`named`).

**The graph frame** (`visibility/shader/graphFrameWgsl.ts`, `frame/render/graphFrame.ts`). One
uniform (48 bytes) for every pass that places a vertex or cuts a pixel: the clocks of the image and
of the one before (world time and wall clock), the camera and the one before, in the camera's fourth
float whether the blue noise of a dithered cutout is bound, then the view's image number
(`GraphFrame.frame`, `stochasticPhase`). Written once per image (`resetFrameCounters`), bound at
each layout's number (`VIS_BINDINGS.frame`, `SHADE_BINDINGS.frame`, `BLEND_BINDINGS.frame`,
`TESS_BINDINGS.frame`, the velocity stage's).

**The graph outputs the rasters evaluate** (`materials/graph/outputProgram.ts`, `maskProgram.ts`,
`wpoProgram.ts`, `graphRasters.ts`). One registry (`rasterRegistry`) builds, per surface program,
the program restricted to one output, the cutout (`opacityMask`, `maskOf`) or the offset
(`worldPositionOffset`, `wpoOf`), with the resolve's values and layout. What an output cannot
evaluate (texture sets named, a texture read the device's stage cannot take) is refused
(`refuseGraph`).

`GraphRasters` is the sorted list of those programs the session's surfaces wear (`graphRastersOf`),
held in `WebgpuVisState.rasters` from its open (`holdGraphRasters`): `cameraMasks`, `shadowMasks`,
`diceMasks` for cutouts; `visibilityWpo`, `voxelWpo`, `tessellationWpo`, `diceWpo`, `shadowWpo`,
`shadowSplitWpo`, `patchVertexWpo`, `shadeWpo`, `blendWpo`, `velocityWpo` for offsets.
`GraphRasters.textures`: a vertex stage may read the colour atlas (`grantsVertexTextures`).

A graph joining the session later is taken at the frame entry that retakes the census
(`followGraphRasters`, `frame/prepare/lateGraphs.ts`): the set is extended, the visibility module,
pipelines, software raster (`ensureGpuRaster`), shadow rasters and tessellation (`vsmRenderContext`)
are remade, and where an offset joined, the temporal pass too (`rigTemporalAgain`, history
restarted, compiled off the thread under a held frame: `track`, `deviceAnswering`); the session is not reopened. The
transparent pass takes it for new copies (`growth.ts`).
