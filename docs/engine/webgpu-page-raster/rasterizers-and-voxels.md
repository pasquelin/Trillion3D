# Rasterizers and voxels

Two rasterizers write the one visibility buffer, chosen cluster by cluster (`visibility/raster/`). The
cluster cull makes the choice where it decides the cluster (`rasteredInHardware`,
`geometry/dag/shader/visibleWgsl.ts`), from its cluster record and its placement: a cluster whose box
crosses the near or the far plane or reaches behind the view's clip plane, or whose longest edge
projects at `hardwareRasterEdgePixels` (32 by default) or more at the nearest point of its
level-of-detail sphere, goes to the hardware rasterizer, which cuts it; every other one to the
software raster. The sphere is the cluster's own; a cluster whose vertices move (a dynamic geometry, a
deformation, an offset) is judged at the sphere around its box grown by its reach, with its rest edge.
The edge is measured once, on the GPU, from the cluster's triangles after its record is written
(`geometry/dag/info/measure.ts`) and kept in a buffer of its own, one f32 a record, zero until then: a
cluster of an unmeasured edge, or with no box, goes to the hardware raster, which draws any. Lines,
sprites and voxels always go to the hardware; `softwareRaster: false` hands it every cluster. A
cluster whose surface is displaced, where the frame tessellates, goes to neither: it is listed for the
tessellation (`VIS_TAG_TESSELLATED`), which seeds its patches from the list. The cull appends the
software clusters from the bottom of the list of visible clusters and the hardware ones from the top.

Between the cull and the rasters the visibility passes decode, order and list the clusters
(`visibility/passes/binning.ts`, one compute pass a pass of the cut, `RASTER_BINNING_PASS`), nothing
read from the host:

- **The decode** (`visibility/decode/decodeWgsl.ts`) writes, for each listed cluster, its record
  (`PageInfo`, 160 bytes, `visibility/pageInfo.ts`) at its index in the list of visible clusters, one
  thread a cluster, from three sources: the cluster's own record, its placement's world (held in
  doubles on the GPU, taken in single precision) and its placement's record
  (`geometry/dag/info/placementInfoLayout.ts`: its deformation, the switches of its object's offset,
  the HLOD level it is drawn as, the results of its deformed pages), which the host writes when a
  placement is made or what it holds changes (`geometry/clusters/placementInfo.ts`). A blended cluster
  has no record here. A plan kernel before it reads the list's header and writes the pass's ranges and
  the dispatch of the decode; the clusters whose vertices a deformation moves are listed for the
  deformation, which runs between the decode and the bins (`deformation/computeWgsl.ts`,
  `deformListed`), the deformed bank tracks and float-pool blocks having run at the frame's start.
- **The bins** (`visibility/bins/binsWgsl.ts`) place each cluster in a group (a hardware slot, the
  software raster's opaque or cutout clusters, or the tessellation's), in four kernels: a count, a
  reservation of each group's place, a scatter and the lists' headers. A hardware slot is a kind
  (opaque, cutout, voxel, or the software clusters the x-ray view walks in the hardware slots too), a
  face mode (the surface's side, swapped by a mirrored world), a coplanar layer and a half (main,
  post pass); it draws by one indirect command whose instances are the clusters, each instance a batch
  of at most 96 corners of its cluster, so the vertex stage reads the cluster's record by the index
  the instance carries. The software and the tessellation's lists are the raster's
  (`visibility/raster/contract.ts`), the post pass's after the main pass's; a cutout or voxel group is
  ordered by depth bucket.

The software raster (`visibility/raster/clusterWgsl.ts`) is a compute pass whose unit of work is the
cluster: one group of 64 threads rasters one listed cluster. The group transforms the cluster's
vertices (at most 256) onto an 8-bit sub-pixel grid once, into its memory, each thread some of them;
then each thread takes a triangle at a time (128 at most in an encoded cluster, two turns of the
group), sets it up (`visibility/raster/triWgsl.ts`: the top-left fill rule, the depth plane, a box of
at most 64 pixels a side) and rasters it itself, by its box row by row or, when a triangle of the
lanes that run together spans more than 4 pixels (a subgroup vote where the device has subgroups, each
lane's own triangle where it has none) or the cluster is masked, by the span each row's edges cover. A
cluster that cannot be held there, an older cache's, transforms the corners of each triangle as it
sets it up. Its list is one a pass of the cut and holds each cluster once, as many as the list of
visible clusters holds room for: the bins append a cluster with one atomic, not a triangle, and the
dispatch that launches the raster is read from the list's own header.

Five settings of the raster are run-time ones, one contract and one resolver each
(`packages/sdk-core/src/contracts/rasterOptions.ts`): `softwareRaster`, `hardwareRasterEdgePixels` and
the depth bucketing's (`depthBucketing`, `depthBucketsMinZ`, `depthBucketsMaxZ`); world options and
render settings of the world's registry (`session/world/settings.ts`, the page over the preset; no
preset level writes them), session options, and the frame reads them from the engine context. The
depth bucketing is the reference's (on by default): the software raster's cutout clusters are rastered
nearest first, each under the bucket of its box's view depth, 256 buckets spread by the logarithm of
the depth between `depthBucketsMinZ` (10 m) and `depthBucketsMaxZ` (1000 m), the reference's
centimetres in metres, after the clusters that read no texture, by a counting sort in the bins'
reservation, so that a hidden cutout fragment leaves (`visPasses`, before `maskKeep`) before its
texture is read. The bucket of a cluster is written by the cull into its record's tag. As in the
reference, whose visible-cluster record holds the bucket only where its project supports assemblies or
voxels, the order is made only where the scene holds voxel clusters; the order never changes a pixel.
The hardware slots' cutout and voxel groups are ordered by the same buckets, nearest first: the
reference orders its hardware dispatches too.

The reference has four more raster switches that this engine has no option for, each for a reason of
its own. The visibility buffer's clear is one native `clearBuffer` of a linear storage buffer (the
reference's compute and tiled clears replace a platform clear that WebGPU does not have to replace).
The raster's lists are sized by the list of visible clusters, which holds every cluster the cut draws
once (`cutMaxVisibleClusters` is its cap), so no multiple of it sizes a list that could overflow. The
hardware slots are walked opaque, cutout, then voxel, the order the reference sorts its dispatches
into. Node and cluster culling run one level per indirect dispatch: the one-kernel form waits on other
workgroups, which WebGPU does not guarantee to run.

Both rasterizers write a pixel by the one rule of `visWriteWgsl` (`visibility/raster/pixelWgsl.ts`):
the 64-bit maximum of `(depth, identifier)` (a depth key, the reversed depth's bits raised by the
cluster's coplanar layer units, over the identifier `(index + 1) << 8 | triangle`, `index` the
cluster's place in the list of visible clusters), whatever the order of threads, passes and rasters:
the nearest wins, a tie goes to the greater identifier.

- A device with the optional WebGPU feature `atomic-vec2u-min-max` (`gpu/core/wideAtomics.ts`,
  requested at the device's creation; WGSL `atomic<vec2<u32>>` and `atomicStoreMax`) holds a pixel as
  one 64-bit word, the identifier in its low half and the depth in its high one, and every fragment is
  written once, by that maximum: the software raster's threads, the tessellation's micro-triangles and
  the hardware slots' fragments, each triangle drawn once. The word cannot be read, so no fragment
  leaves early.
- A device without it keeps the same result by other means: the hardware raster draws each triangle
  once, with the hardware depth test, into the scene's depth attachment (the fragment's depth is the
  key) and an identifiers target of its own; the software raster writes two 32-bit planes, a depth key
  by `atomicMax` in a first mode, then in a second, once both passes' depths are down, the identifier
  of each fragment whose key is exactly the pixel's, by `atomicMax`; the export merges the two rasters,
  the nearer winning, a tie going to the greater identifier.

The two paths give one image except between two fragments of different identifiers at exactly the same
depth from the hardware raster alone, which the depth test (greater or equal) settles for the later
draw. The host switch `trillion3dGpuFeaturesOff=atomic-vec2u-min-max` names the feature off.

The cut draws in two passes (`visibility/passes/passes.ts`), and the raster follows them
(`frame/render/encodeVisSetup.ts`): each pass has its own decode and bins, its own list of clusters in
the lists buffer and its own half of the hardware slots, its clusters those the cut listed before its
post pass opened (the main pass's) or after (the post pass's), read through a uniform entry of its
own. No kernel reads a verdict. One compute pass exports the buffer (`visibility/raster/export.ts`)
into the depth level the Hi-Z is built from after each pass's depth; the last one, once both passes'
depths are down, into the identifiers the material passes read (the shading mask the surface passes
classify by), and a full-screen draw writes the scene's depth attachment from that level: WebGPU lets
a texture be a storage binding only in a format of its colour table and a `depth32float` texture takes
a copy only from another of its format (§ 6.1 and § 26.1.2.2 of the WebGPU specification), so a
compute pass cannot write the attachment.

A voxel page ([FORMAT.md](../../format/pages.md#voxels)) (a voxelized mesh's far levels, a `voxel` HLOD
cell) is a page like any other: catalogued, streamed and chosen by the one cut at its voxels' error.
Each brick draws its box, the box of the cells its mask holds, by its back faces alone, so an eye
inside a box or a box across the near plane still draws; each pixel of the box casts the eye's ray
through the brick's cells (`visibility/shader/voxelWgsl.ts`, `voxelCellTrace`): it enters at the box,
or at the eye inside it, steps cell to cell by a 3D DDA, reads each cell's bit of the brick's 64-bit
mask, and stops at the first solid cell, at most 10 steps (the most cells a line crosses in a 4³
brick). The ray and its clip depth are affine in the box point: the vertex stage computes them at the
box's corners and the pixel gets its own by interpolation, so a voxel fragment runs the DDA and one
division, reads no buffer, builds no matrix (`visibility/shader/voxelHitWgsl.ts`). Voxel rows have
slots and a shader module of their own (`visibility/shader/visVoxelWgsl.ts`), drawn after the opaque
and cutout ones, on layer 0, and only on a frame whose table holds a voxel row: the other slots
compile the text they compiled before voxels. A voxel fragment always runs its trace: it traces its
cells before it can compare the depth. The shadow pages draw voxel rows in tiers of their own, sized
by the page's bricks as the corner tiers are by its triangles, their module apart
(`render/renderVoxelWgsl.ts`), on the same sequence; the resolve of a voxel class, its module apart
too, traces the pixel again to read its voxel's colour, roughness, occlusion and normal (its rank one
read of its brick and a popcount), its normal carried by the brick's joint. Every voxel module and
pipeline is made the first time the table holds a voxel row or a voxel class: a scene without voxels
compiles what it compiled before them. A skinned mesh's bricks follow their joint rigidly and are
traced at rest. Ray queries take the finer clusters a voxel page stands for, never the page. The
`voxels` view paints each voxel in its level's colour; the metrics `voxelStepsMean` and
`voxelStepsMax` sample the DDA steps a pixel took.

