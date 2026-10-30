# Rasterizers and voxels

Two rasterizers write the visibility buffer, chosen per cluster (`visibility/raster/`) by the cluster
cull (`rasteredInHardware`, `geometry/dag/shader/visibleWgsl.ts`): a cluster whose box crosses the near
or far plane or reaches behind the view's clip plane, or whose longest edge projects at
`hardwareRasterEdgePixels` (32 default) or more at the nearest point of its LOD sphere, goes to
hardware; every other to the software raster. A cluster with moving vertices (dynamic geometry,
deformation, offset) is judged at the sphere around its box grown by its reach, with its rest edge. The
edge is measured once on the GPU (`geometry/dag/info/measure.ts`), one f32 a record, zero until then:
unmeasured edge or no box goes to hardware. Lines, sprites and voxels always go to hardware;
`softwareRaster: false` hands it every cluster. A displaced cluster where the frame tessellates goes
to neither: it is listed for the tessellation (`VIS_TAG_TESSELLATED`). The cull appends software
clusters from the bottom of the visible-cluster list, hardware ones from the top.

Between cull and rasters the visibility passes decode, order and list the clusters
(`visibility/passes/binning.ts`, one compute pass a cut pass, `RASTER_BINNING_PASS`):

- **Decode** (`visibility/decode/decodeWgsl.ts`) writes, per listed cluster, its record (`PageInfo`,
  160 bytes, `visibility/pageInfo.ts`) at its visible-cluster index, from the cluster's record, its
  placement's world (doubles on the GPU, taken in single precision) and its placement's record
  (`geometry/dag/info/placementInfoLayout.ts`: deformation, offset switches, HLOD level drawn, deformed
  pages' results; host-written, `geometry/clusters/placementInfo.ts`). A blended cluster has no record.
  A plan kernel writes the pass's ranges and the decode's dispatch; clusters a deformation moves are
  listed for it, between decode and bins (`deformation/computeWgsl.ts`, `deformListed`).
- **Bins** (`visibility/bins/binsWgsl.ts`) place each cluster in a group (hardware slot, software
  opaque or cutout, or tessellation) in four kernels: count, reservation, scatter, lists' headers. A
  hardware slot is a kind (opaque, cutout, voxel, or the software clusters the x-ray view walks in
  hardware), a face mode (swapped by a mirrored world), a coplanar layer and a half (main, post); one
  indirect command whose instances are the clusters, each a batch of at most 96 corners. The software
  and tessellation lists are the raster's (`visibility/raster/contract.ts`), post pass's after main's;
  a cutout or voxel group is ordered by depth bucket.

The software raster (`visibility/raster/clusterWgsl.ts`): one group of 64 threads rasters one listed
cluster. The group transforms the vertices (at most 256) onto an 8-bit sub-pixel grid; each thread
takes a triangle at a time (128 at most), sets it up (`visibility/raster/triWgsl.ts`: top-left fill
rule, depth plane, box of at most 64 pixels a side) and rasters it by its box row by row or, when a
triangle of the lanes running together spans more than 4 pixels (subgroup vote, or each lane's own
triangle without subgroups) or the cluster is masked, by the span each row's edges cover. A cluster
that cannot be held there (an older cache's) transforms each triangle's corners as it sets it up. The
list holds each cluster once; the dispatch is read from its header.

Five raster settings are run-time ones (`packages/sdk-core/src/contracts/rasterOptions.ts`):
`softwareRaster`, `hardwareRasterEdgePixels`, `depthBucketing`, `depthBucketsMinZ`,
`depthBucketsMaxZ`; world options and render settings (`session/world/settings.ts`; no preset level
writes them), session options. Depth bucketing (on by default): software cutout clusters are rastered
nearest first, each under the bucket of its box's view depth, 256 buckets spread by log depth between
`depthBucketsMinZ` (10 m) and `depthBucketsMaxZ` (1000 m; reference in centimetres), after the
clusters that read no texture, by a counting sort in the bins' reservation (`visPasses`, before
`maskKeep`). The cull writes the bucket into the record's tag. As in the reference, the order is made
only where the scene holds voxel clusters. Hardware cutout and voxel groups use the same buckets.

Differences from the reference (four raster switches with no option): the visibility buffer's clear is
one native `clearBuffer`; lists are sized by the visible-cluster list (`cutMaxVisibleClusters` its
cap); hardware slots are walked opaque, cutout, voxel; node and cluster culling run one level per
indirect dispatch.

Both rasterizers write a pixel by one rule, `visWriteWgsl` (`visibility/raster/pixelWgsl.ts`): the
64-bit maximum of `(depth, identifier)` (depth key = reversed depth's bits raised by the cluster's
coplanar layer units; identifier `(index + 1) << 8 | triangle`, `index` the cluster's place in the
visible-cluster list): the nearest wins, a tie goes to the greater identifier.

- With the optional feature `atomic-vec2u-min-max` (`gpu/core/wideAtomics.ts`, requested at device
  creation; WGSL `atomic<vec2<u32>>` and `atomicStoreMax`) a pixel is one 64-bit word, identifier low,
  depth high, written once per fragment by that maximum (software threads, tessellation
  micro-triangles, hardware slot fragments). No fragment leaves early.
- Without it: hardware draws with the depth test into the scene's depth attachment (fragment depth is
  the key) and its own identifiers target; software writes two 32-bit planes, a depth key by `atomicMax`,
  then, once both passes' depths are down, the identifier of each fragment whose key is the pixel's, by
  `atomicMax`; the export merges the rasters, nearer winning, a tie to the greater identifier.

Difference: fragments of different identifiers at the same depth from the hardware raster alone go to
the later draw (depth test greater or equal). The host switch
`trillion3dGpuFeaturesOff=atomic-vec2u-min-max` turns the feature off.

The cut draws in two passes (`visibility/passes/passes.ts`, `frame/render/encodeVisSetup.ts`): each
has its own decode, bins, cluster list in the lists buffer, half of the hardware slots and uniform
entry; main takes the clusters the cut listed before its post pass opened, post those after. One
compute pass exports the buffer (`visibility/raster/export.ts`) into the depth level the Hi-Z is built
from after each pass; the last, once both depths are down, into the identifiers the material passes
read; a full-screen draw writes the scene's depth attachment from that level (a compute pass cannot).

A voxel page ([FORMAT.md](../../format/pages.md#voxels)) (a voxelized mesh's far levels, a `voxel` HLOD
cell) is catalogued, streamed and chosen by the cut at its voxels' error like any page. Each brick draws
its box (the cells its mask holds) by back faces alone; each box pixel casts the eye's ray through the
brick's cells (`visibility/shader/voxelWgsl.ts`, `voxelCellTrace`): enters at the box (or the eye
inside it), steps by a 3D DDA, reads each cell's bit of the brick's 64-bit mask, stops at the first
solid cell, at most 10 steps (4³ brick). Ray and clip depth are interpolated from the box corners
(`visibility/shader/voxelHitWgsl.ts`). Voxel rows have own slots and shader module
(`visibility/shader/visVoxelWgsl.ts`), drawn after the opaque and cutout ones, on layer 0, only on a
frame whose table holds a voxel row. Shadow pages draw voxel rows in their own tiers, module
`render/renderVoxelWgsl.ts`; the resolve of a voxel class (own module) traces the pixel again to read
colour, roughness, occlusion and normal (rank one read of its brick and a popcount), the normal carried
by the brick's joint. A skinned mesh's bricks follow their joint rigidly and are traced at rest. Ray
queries take the finer clusters a voxel page stands for. The `voxels` view paints each voxel in its
level's colour; the metrics `voxelStepsMean` and `voxelStepsMax` sample the DDA steps a pixel took.
