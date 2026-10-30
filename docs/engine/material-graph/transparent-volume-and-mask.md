# Transparent pass, volume, mask and pixel programs

**The transparent pass** (`blend/graphWgsl.ts`). The blend module holds the functions of every
program of the graphs its items wear (`graphProgramsOf`, compiled for the pass:
`programOf(surface, 'blend')`), as do the front stage's and transmissive stages' modules. It
evaluates each fragment's program once, among the screen derivatives (`blendGrads`), before any test:
the record's `graph` word (under the facing bits the vertex stage puts above the item's rank) names
the values, their header the program, and a switch picks the function (`@diagnostic(off, derivative_uniformity)`
on the functions taking derivatives under it: a quad shares one primitive). The record is neutral for
such an item, so the vertex stage hands the fragments factors that change nothing, no map and no thin
transmission. A lobed module's lobes are the graph's (`blendGraphLobes`, before the item is lit); the
refraction the transmissive stage bends by is the graph's where it wires one (`transmitInvIor`: the
index as wired, zero meaning none; of the reference's three refraction modes the index of refraction
is the one ported); the specular sets the pixel's reflectance before its lights (`surfaceSpecular`).
A session whose copies bring a program its modules lack rebuilds its blend programs (`grantGraphs`,
`buildGranted`).

**The volume** (`lighting/fog/voxelGraph.ts`). An image's object graphs are the programs of one
voxelisation program, made when the set changes (`FogGraphResources.graphVoxelize`; the programs of
the current and previous sets are kept, so a camera walking across the edge of a fog object with a
graph compiles neither again). An object's record names its program by its place in the set and its
values by their texel in one buffer (`voxelGraphValues`); the colour atlas is bound where a graph
reads a texture; the plain voxelisation serves until the program is compiled. A cell the object's
mask or the fade leaves nothing of never evaluates the graph. The textures are taken into the atlas
and asked at full detail (`fogGraphMaps`).

**The opacity mask** (`materials/graph/maskProgram.ts`, `visibility/shader/maskGraphWgsl.ts`,
`maskSets.ts`, `materials/table/graphRecord.ts`). A surface whose resolve-kind graph wires
`opacityMask` is masked (`blendOf` gives `'mask'`; rows carry the cutout bit `FLAG_MASK`, the record
the clip value as `cut`, kept as is, 0 included). Its mask is the opaque resolve program restricted to
that output: the values written beside the record keep that program's layout, so the mask reads them
as the resolve does, chosen by the program's id in the header, which also says the program holds a
mask (`GRAPH_HEADER.mask`).

Every raster that cuts holds the mask functions of the programs the session's set holds (`MaskSet`:
`cameraMasks` for the visibility rasters and dicing, with the render pixel's footprint; `shadowMasks`
for the shadow depth passes, at the pool's own level), `maskKeepWgsl` selecting by id; a program the
module lacks keeps every pixel. `maskKeepAt` is the same test with the pixel a dithered cut needs
(hardware and compute raster, shadow raster); `maskKeep` is the one without a pixel. A module made
without graph masks and dither is word for word what it was. The clocks a mask reads are the graph
frame's.

The dither is a bit of the record's model word (`DITHER_MODEL_BIT`, set from `ditherOpacityMask` for
any masked surface, a graph's or an `alphaTest`'s): the cut value plus `0.83 · noise − 0.5`, the noise
being the engine's blue noise (`blueNoiseScalar`) read at the pixel and the image's frame (the view's
own count of images drawn, `stochasticPhase`, which its lighting noise turns with: not the wall
clock, not another view's), applied where the graph frame says the noise is bound (`eye.w`). The
dicing, which cuts at a vertex, keeps the hard test. A diced vertex whose mask is below the clip value
drops the micro-triangles using it, as a vertex behind the camera does. A mask the rasters cannot
evaluate (a world position, camera, normal, two texture sets) is refused through `refuseGraph`; its
surface is drawn whole.

**The pixel programs** (`materials/graph/pixelProgram.ts`, `pdoProgram.ts`,
`displacementProgram.ts`). Besides the cutout, the rasters evaluate two more outputs in the cutout's
context (its first texture set, footprint, clocks; a graph reading a world position, camera, normal,
vertex colour or two sets there is refused): `pixelDepthOffset` and `displacement`. `pixelOf` joins
the three restricted programs of one surface program into one `PixelProgram` (`cuts`, `offsets`,
`displaces`; `GraphRasters.masks` holds them), whose header bits (`GRAPH_HEADER.mask`, `depthOffset`,
`displacement`) name which outputs the values carry.

_Depth offset_: a row wiring it carries `FLAG_DEPTH_OFFSET` and, to read its coordinate, `FLAG_MASK`.
The software raster (`writePixel`, `raster/pixelWgsl.ts`) and the hardware raster's fragment
(`shader/visWgsl.ts`) evaluate `depthOffsetValue` after the cutout and write `offsetDepth` in the
depth key's place: the output times the cosine of the pixel's ray with the view axis (`Uniforms.focal`,
the projection's scale on each axis) added to the clip w, never nearer than the plane's, and the
offset over `Uniforms.depthSpan` taken off an orthographic view's affine depth; the early-out is
taken once it is read. The shadow maps and dicing write their triangles' depth, as the reference's
depth-only and tessellated paths do.

_Displacement_: a surface whose record has `displacement` numbers (the material's
`displacementMagnitude`, `displacementCenter`, `displacementFadeStart`/`End`,
`session/world/materials/surface.ts`) and no height map, the output being wired, has a displacement
record (`materials/table/displacementRecord.ts`) with mark `1` in `map.z`, its rank in `map.w`, the
output's texture set in `map.y`. `diceHeight` (`visibility/tessellation/heightWgsl.ts`, the weak
default being the map's read in `diceSetupWgsl.ts`) then reads `displacementValue` for that rank, in
the dicing of the image and of the shadow maps alike (`maskKeepWgsl` lists it where a program
displaces). Rows carry `FLAG_DISPLACED` and the culling boxes grow by the displacement's reach
(`pagesDisplacementReach`). The reference's `TessellationMultiplier` is deprecated and read by no
shader: it is no output.

