# Ray tracing

Every compiled primitive gets a tree a ray tracer walks, written with the others in `rayTracing.bin`
(`ray_tracing/`), which the manifest's `rayTracing` section names
([FORMAT.md](../format/raytracingbin.md#raytracingbin)); so does every HLOD actor of the world, and
a directory of the actors comes last. The tree is built over a coarse cut of the primitive's cluster
DAG, taken as the pages carry it:

1. **The cut.** Its error is one hundredth of the mesh's size (the square root of the smaller of
   twice the area of the finest clusters and the surface of their box), and it holds every cluster
   whose error it does not exceed and whose group's it exceeds: the surface is whole, with no
   triangle twice. Each triangle keeps the rank of its cluster and its own in it.
2. **The tree.** A binary tree over the cut's triangles, split by the surface area heuristic (16
   bins on each axis, leaves of at most 3 triangles), is collapsed into nodes of eight children by
   opening the child of largest surface until a node has eight. The children take the slots in the
   order they were opened (the walk measures the span of every child it meets and goes to the
   nearest), and their boxes are quantised in the node's own frame, on a byte a coordinate. A tree
   whose walk would keep more than 64 nodes on its stack is split in halves instead of at the
   cheapest cuts; one that needs more even so stops the compile (`RAY_TRACING_TREE_TOO_DEEP`).
3. **The world's trees.** The HLOD actors are meshes of their own in the world's one DAG, each cut
   at the error of its own finest clusters, not at one for the world, and written as a record of its
   own naming the HLOD cell that shows it. The directory is a tree over the actors' boxes, one entry
   for each, so that a ray finds the actors of the cells the cut draws without trying every actor. A
   voxel actor has none.

A count or a rank that does not fit the file's 32-bit words stops the compile
(`RAY_TRACING_TOO_LARGE`) rather than being written cut short.

The tree is the same at every run, whatever the threads. A primitive's flags tell the reader whether
its material is double-sided, alpha-masked or translucent; an actor's are those of the material it
wears, a flattened material's as it is published.
