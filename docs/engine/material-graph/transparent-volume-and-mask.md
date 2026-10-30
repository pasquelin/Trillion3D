# Transparent pass, volume, mask and pixel programs

**The transparent pass** (`blend/graphWgsl.ts`). The blend, front and transmissive modules hold the
functions of the graphs their items wear (`graphProgramsOf`, `programOf(surface, 'blend')`). Each
fragment's program is evaluated once, among the screen derivatives (`blendGrads`), before any test:
the record's `graph` word names the values, their header the program
(`@diagnostic(off, derivative_uniformity)` on functions taking derivatives under it). The record is neutral.

- A lobed module's lobes are the graph's (`blendGraphLobes`).
- Refraction is the graph's where it wires one (`transmitInvIor`: the index as wired, zero meaning
  none); only the index-of-refraction mode of the reference is ported.
- The specular sets the pixel's reflectance before its lights (`surfaceSpecular`).
- Copies bringing a program its modules lack rebuild the blend programs (`grantGraphs`,
  `buildGranted`).

**The volume** (`lighting/fog/voxelGraph.ts`). An image's object graphs are the programs of one
voxelisation program, made when the set changes (`FogGraphResources.graphVoxelize`). An object's
record names its program by its place in the set and its values by their texel in one buffer
(`voxelGraphValues`; textures `fogGraphMaps`); plain voxelisation serves until the program is
compiled. A cell the object's mask or fade empties never evaluates the graph.

**The opacity mask** (`materials/graph/maskProgram.ts`, `visibility/shader/maskGraphWgsl.ts`,
`maskSets.ts`, `materials/table/graphRecord.ts`). A surface whose resolve-kind graph wires
`opacityMask` is masked (`blendOf` gives `'mask'`; rows carry `FLAG_MASK`, the record the clip value
as `cut`, 0 included). Its mask is the opaque resolve program restricted to that output, with the
same value layout, chosen by the program's id in the header (`GRAPH_HEADER.mask`).

Rasters that cut hold the session's mask functions (`MaskSet`: `cameraMasks` for the visibility
rasters and dicing; `shadowMasks` for shadow depth), selected by id (`maskKeepWgsl`); a program the
module lacks keeps every pixel. `maskKeepAt` takes the pixel a dithered cut needs (hardware, compute
and shadow raster); `maskKeep` does not.

The dither is a bit of the record's model word (`DITHER_MODEL_BIT`, set from `ditherOpacityMask` for
any masked surface, a graph's or an `alphaTest`'s): the cut value plus `0.83 · noise − 0.5`, blue
noise (`blueNoiseScalar`) at the pixel and the view's image count (`stochasticPhase`), where the
graph frame says the noise is bound (`eye.w`). Dicing keeps the hard test; a diced vertex below the
clip value drops its micro-triangles. A mask the rasters cannot evaluate (world position, camera,
normal, two texture sets) is refused (`refuseGraph`); its surface is drawn whole.

**The pixel programs** (`materials/graph/pixelProgram.ts`, `pdoProgram.ts`,
`displacementProgram.ts`). Besides the cutout, the rasters evaluate `pixelDepthOffset` and
`displacement` in the cutout's context (first texture set; a graph reading a world position, camera,
normal, vertex colour or two sets there is refused). `pixelOf` joins a surface program's three
restricted programs into one `PixelProgram` (`cuts`, `offsets`, `displaces`; `GraphRasters.masks`);
header bits `GRAPH_HEADER.mask`, `depthOffset`, `displacement`.

_Depth offset_: a row wiring it carries `FLAG_DEPTH_OFFSET` and `FLAG_MASK`. The software raster
(`writePixel`, `raster/pixelWgsl.ts`) and the hardware fragment (`shader/visWgsl.ts`) evaluate
`depthOffsetValue` after the cutout and write `offsetDepth` as the depth key: the output times the
cosine of the pixel's ray with the view axis (`Uniforms.focal`) added to the clip w, never nearer
than the plane's; an orthographic view's affine depth takes it over `Uniforms.depthSpan`. Shadow
maps and dicing write their triangles' depth.

_Displacement_: a surface whose record has `displacement` numbers (`displacementMagnitude`,
`displacementCenter`, `displacementFadeStart`/`End`, `session/world/materials/surface.ts`) and no
height map, the output being wired, has a displacement record
(`materials/table/displacementRecord.ts`): mark `1` in `map.z`, rank in `map.w`, texture set in
`map.y`. `diceHeight` (`visibility/tessellation/heightWgsl.ts`; weak default in `diceSetupWgsl.ts`)
reads `displacementValue` for that rank, in the dicing of the image and of the shadow maps. Rows
carry `FLAG_DISPLACED`; culling boxes grow by the reach (`pagesDisplacementReach`). The reference's
deprecated `TessellationMultiplier` is no output.
