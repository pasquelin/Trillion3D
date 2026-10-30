# Tessellation of displaced rows

A row whose surface is displaced (`FLAG_DISPLACED`, bit 31 of the page's flags) is drawn by the
tessellation, not by either rasterizer, when the `tessellation` setting is on and the cluster is none
of a line, a sprite or a voxel brick (`visibility/tessellation/rowWgsl.ts`, `tessellatedRow`): the
cluster cull lists it with the tag `VIS_TAG_TESSELLATED` and the bins queue it in the tessellation's
list. A masked
surface, a skinned or morphed one and one the host rewrites in place are tessellated: their corners
are read as the frame deforms them, and a masked surface's cutout is read at the micro-triangles'
vertices (below). A scene that holds no displaced surface allocates, compiles, binds and dispatches
nothing for it, and the cluster cull is the text it was.

Each pass of the cut (`visibility/raster/raster.ts`) runs, in the same compute pass as its decode
and bins:

1. **Seeding** (`seedWgsl.ts`): one workgroup a listed cluster, dispatched from the list's own
   header, each triangle's three edge factors from the corners in the world — an edge's length over the depth of its nearer end, times the pixels a unit
   subtends at depth one per pixel an edge may span (the cut's `pixelError`), over the dicing rate.
   A triangle none of whose factors passes 8 is queued whole; any other is cut once by the pattern
   of its factors over 14, held to 8 pieces an edge.
2. **Six levels of splitting** (`splitWgsl.ts`, planned by `planWgsl.ts`): each patch of the level is
   placed on its triangle by its barycentrics; the box its corners span, grown by the displacement
   along the cone of the three normals, is judged by the view (`sightWgsl.ts`): outside the frustum,
   behind the eye or past the clip plane it is gone; under the Hi-Z pyramid it is hidden. The main
   pass tests the previous image's pyramid at the previous image's matrix and keeps the patches it
   hides (`occluded`, as large as the queue); the post pass takes them up again (`tessResume`) and
   tests them, and every patch of its own, against the pyramid built from what the main pass drew,
   dropping what it hides. A cut in one pass tests no patch. The factors of a patch that is seen are
   measured again — an edge past the far distance, where the displacement has faded, is cut a quarter
   as finely — and a patch still asking more than 14 is cut by its pattern and its children go to the
   next level; the others go to the pass's visible list.
3. The dicing's dispatch (`tessVisibleArgs`), then the **dicing** inside each mode of the software
   raster (`diceWgsl.ts`): a group takes `tessellationMaxPatchesPerGroup` patches one after another,
   its 64 threads a patch's vertices — a barycentric point of the source triangle, its height read in
   the height map at the level the micro-triangle's size asks for, its clip position pushed along the
   interpolated normal — then its micro-triangles, each set up as a software triangle and written by
   the same rule as the rasterizers' (`visWriteWgsl`). The pixel's identifier is the source
   triangle's. A vertex of a masked row whose cutout is not kept (the base map's alpha at the
   vertex, times the vertex colour's, under the material's threshold) drops the micro-triangles that
   use it; no pixel is tested.

A pattern is a triangle of 15-bit barycentric vertices and the triangles that join them, one for each
triple of edge factors from 1 to 14: the edge of factor `n` is cut in `n` pieces, so neighbours cut
a shared edge alike. The 560 patterns are built once, the first time a displaced surface is drawn
(`visibility/tessellation/table/`); they are the reference's table word for word.

**What the pixel shows.** The visibility buffer holds the source triangle's identifier, not the
point of it the pixel shows. The resolve of a class that draws a displaced pixel (a pipeline of its
own over a group of its own, made when a scene tessellates one: `prismFrame.ts`; no other class
binds anything more) solves the displaced prism: from the depth the pixel resolved to it takes the
pixel's position in the object's space, then twice the closest point of the triangle, its
interpolated normal, the distance the pixel lies along it and the corners pushed by that distance;
the weights of the pixel on the final triangle, and those of the two neighbouring pixels by the rays
through them, give the pixel's barycentrics and their derivatives (`prismWgsl.ts`). A base map,
normals and every other attribute of the surface follow the displaced surface.

**Shadows.** A virtual shadow map draws the displaced surfaces the same way (`lighting/shadows/vsm/
tessellation/`): the records of a displaced surface — a caster row and the window of map pages it
casts into — are not drawn as their triangles; the records of a view pass of the raster are cut into
patches by the same seeding (every triangle queued whole), six levels of splitting by the view of the
window's map — a patch off the window is gone — and a vertex stage that dices the visible patches with the image's
factors, pattern and height read, and draws them into the window with the casters' own depth
fragment. A point the fade has not left whole takes the least displacement, `−center × magnitude`,
so the surface does not shadow itself where it fades out. The two shadow settings of `world.tessellation` ([SDK.md](../SDK.md)) decide, per kind
of light, whether the maps take it; off, a surface casts the flat triangles it is made of. A
masked displaced surface is cut out at the vertices of its patches where the device grants a
vertex stage nine storage buffers, and per pixel where it grants eight (see Masked casters in the
shadow maps, below).

The primitive's culling boxes are grown by the material's largest displacement
(`geometry/dag/pack/packNodes.ts`): the box tests of the cut and the occlusion culling then hold
every displaced point.

## Motion of a displaced pixel

The velocity stage moves a displaced pixel back by the point of its triangle that lies under it —
the point of the same weights on the triangle as the last image deformed and placed it — and adds
this image's displacement to it whole, so a displaced surface that moves, turns or deforms has the
motion its surface has, not the flat triangle's. Only an image that draws a surface tessellated
does so: it runs its own programs for the velocity stage and the temporal pass's nearest velocity,
compiled when the scene first holds a displaced surface; every other image, and a scene without a
displaced surface, runs the programs it ran before, which hold none of the solve.

## The clip switch

The patches' sight test and the cluster cull's routing of what reaches behind the plane to the
hardware raster (`straddlesClipPlane`) follow the one project switch that decides whether a view's
clip plane is cut by the rasters
(`cutClipPlane`), chosen when the programs are made: without it none of the plane's code is in
their text.

## Masked casters in the shadow maps

A displaced row whose material is masked is drawn through the patches in the shadow maps too,
with the cutout the image's dicing reads. On a device whose vertex stage binds nine storage buffers
(the engine asks for all the adapter offers, its vertex stage's limit included) the patches' vertices
are cut out; on a device that grants only the eight WebGPU guarantees the patches are drawn whole and
the fragment cuts them out per pixel, as any masked row's triangles are.
