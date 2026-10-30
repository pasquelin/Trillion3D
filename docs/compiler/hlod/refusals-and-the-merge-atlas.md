# Refusals and the merge atlas

The compiler refuses the job (`INVALID_OPTIONS`, never the whole batch) for:

- a field the layer's builder does not take; a name given twice; a parent or rule naming no layer; a cycle
- a parent wearing its sources' materials above a layer whose actors wear their own
- a non-spatially-loaded layer naming a cell size or loading range
- a chain past 256 levels (8 bits in the world table)
- a match naming nothing; a regular expression that does not compile
- an atlas setting on a `merge` layer keeping its materials; `bakeVertexColors` on one merging them
- a sizing's setting beside another sizing (a `merge` layer's `textureSize` beside a sizing other
  than `fixed` and `biased` included); a size filter's setting beside another filter
- `opacity` and `opacityMask` both baked; a non-boolean `extras.hlodInclude`; values out of bounds

The HLOD is part of the cache key.

A `merge` layer merging its materials makes one entry per material and bake target: a full-frame
quad, the tile its sources' coordinates address, or, where the look depends on the mesh
(`bakeOnMesh`) or on what lies behind a translucent material (`translucency`, whatever `bakeOnMesh`
says), that mesh's triangles at coordinates laid once per mesh: its lightmap texture set where
`reuseLightmapUVs` (default on) finds one, else coordinates from `uvMethod`. A material is baked
once. Each entry is baked at the atlas's side,
one sample a texel at its centre, by the GPU on the compile's one device. Texels no triangle covers take the mean of their neighbours ring by ring. Entries fill a grid of `⌈√n⌉` cells a side
(or binned squares), each brought down to its cell less its gutter by a Mitchell–Netravali cubic;
each object's texture coordinates move into its entry's cell.

Generated coordinates (a mesh with no texture set to reuse, or `reuseLightmapUVs: false`) are by
default patches (`uvMethod` `default` or `patchBuilder`; `xAtlas` cuts and packs charts, as an
`approximate` layer's `uvMethod: 'charts'` does; `legacy` and `uvAtlas` as above). Fixed settings,
whatever the layer: 100 initial patches, normal turn weighed once, islands merged up to mean squared area distortion 1.5 and normal
turn 45°.

- A triangle naming a point twice or repeating another is left out and keeps its first texture set.
- `reuseLightmapUVs: false` unwraps all entries' triangles as one mesh, one packing; points are
  welded within an entry only.
- Seeds: one per (mesh area / patch count), at most one per vertex; the next seed of a component is
  the triangle furthest from its seeds; each triangle goes to the nearest seed by a distance
  weighed by normal turn; a one-triangle patch joins a neighbour.
- Each island is flattened by an exponential map from its vertex furthest from its longest
  boundary loop, turned about its normal to the world's horizontal axes. Vertex normals are
  weighed by area and interior angle, smoothed five times. Axes are `z`-up (scene `y`/`z` exchanged).
- A whole map (open island, every vertex reached) is turned to its least-area bounding box (one
  direction per convex-hull edge, single precision) only if strictly smaller than the axis-aligned one.
- Islands are packed into 512 texels. With no layout (more islands than texels, or islands of no
  area), the maps' coordinates are kept and baked as they lie in the square.

An `approximate` layer's `uvMethod: 'patches'` unwraps its shell the same way at its own patch
settings, then packs the islands onto its atlas's blocks; with no layout it keeps the coordinates.

An `approximate` layer's `uvMethod: 'uvAtlas'` cuts its shell by spectral analysis into as many
charts as keep stretch under `uvAtlasStretch`, packed into 512 texels with a 2.5-texel gutter, then
onto the atlas's blocks. A vertex shared by two fans of triangles makes the cut fail; the shell is
then projected from its bounding box's faces (each triangle onto the face its normal is nearest)
and packed the same way. A `merge`
layer's `uvAtlas` uses a fixed stretch bound (0.11); a mesh whose cut fails keeps its first
texture set.
