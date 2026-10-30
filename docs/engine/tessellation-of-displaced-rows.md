# Tessellation of displaced rows

A displaced row (`FLAG_DISPLACED`, bit 31 of the page's flags) is drawn by the tessellation, not by
either rasterizer, when the `tessellation` setting is on and the cluster is no line, sprite or voxel
brick (`visibility/tessellation/rowWgsl.ts`, `tessellatedRow`): the cluster cull lists it with tag
`VIS_TAG_TESSELLATED`; the bins queue it in the tessellation's list. Masked, skinned, morphed and
host-rewritten surfaces are tessellated. A scene with no displaced surface pays nothing.

Each pass of the cut (`visibility/raster/raster.ts`) runs, in the same compute pass as its decode and
bins:

1. **Seeding** (`seedWgsl.ts`): one workgroup a listed cluster; each triangle's three edge factors:
   edge length over the depth of its nearer end, times pixels per unit at depth one, per pixel an edge
   may span (`pixelError`), over the dicing rate. A triangle with no factor over 8 is queued whole;
   any other is cut once by the pattern of its factors over 14, held to 8 pieces an edge.
2. **Six levels of splitting** (`splitWgsl.ts`, planned by `planWgsl.ts`): each patch is placed on its
   triangle by barycentrics; its box, grown by the displacement along the cone of the three normals, is
   judged by the view (`sightWgsl.ts`): outside the frustum, behind the eye or past the clip plane it
   is gone; under the Hi-Z pyramid it is hidden. The main pass tests the previous image's pyramid at
   the previous matrix and keeps the patches it hides (`occluded`); the post pass resumes them
   (`tessResume`) and tests them, and its own, against the pyramid built from the main pass. A cut in
   one pass tests no patch. A seen patch's factors are measured again (an edge past the far distance is
   cut a quarter as finely); a patch still asking more than 14 is cut by its pattern, children going
   to the next level; the others go to the visible list.
3. Dicing dispatch (`tessVisibleArgs`), then **dicing** inside each software-raster mode
   (`diceWgsl.ts`): a group takes `tessellationMaxPatchesPerGroup` patches in turn, its 64 threads a
   patch's vertices (barycentric point, height read in the height map at the level the micro-triangle's
   size asks for, clip position pushed along the interpolated normal), then its micro-triangles,
   written by the rasterizers' rule (`visWriteWgsl`); pixel identifier = source triangle's. A masked vertex whose cutout is not kept (base map alpha times vertex colour's, under the material's
   threshold) drops the micro-triangles using it.

A pattern (15-bit barycentric vertices plus joining triangles) exists per triple of edge factors 1 to
14; factor `n` cuts the edge in `n` pieces. The 560 patterns are built at the first displaced draw
(`visibility/tessellation/table/`); they are the reference table.

**What the pixel shows.** The visibility buffer holds the source triangle's identifier. The resolve of
a class drawing a displaced pixel (`prismFrame.ts`) solves the displaced
prism from the resolved depth (`prismWgsl.ts`); all attributes follow the displaced surface.

**Shadows.** A virtual shadow map draws displaced surfaces the same way
(`lighting/shadows/vsm/tessellation/`): a view pass cuts a displaced surface's records (caster row,
window of map pages) into patches by the same seeding, six levels of splitting by the view of the
window's map, and a vertex stage dices the visible patches and draws them into the window with the
casters' depth fragment. A point the fade has not left whole takes displacement `−center × magnitude`. The two shadow settings of `world.tessellation` ([SDK.md](../SDK.md)) decide
per kind of light whether the maps take it; off, a surface casts its flat triangles. Primitives'
culling boxes are grown by the material's largest displacement (`geometry/dag/pack/packNodes.ts`).

## Motion of a displaced pixel

The velocity stage moves a displaced pixel back by the point of its triangle under it (same weights on
the triangle as the last image deformed and placed it) and adds this image's displacement whole. Such images run own velocity and temporal nearest-velocity programs, compiled at the first displaced surface.

## The clip switch

The patches' sight test and the cluster cull's routing (`straddlesClipPlane`) follow the project
switch `cutClipPlane`, chosen when the programs are made.

## Masked casters in the shadow maps

Where the vertex stage
binds nine storage buffers the patches' vertices are cut out; where the device grants only the eight
WebGPU guarantees, patches are drawn whole and the fragment cuts them out per pixel.
