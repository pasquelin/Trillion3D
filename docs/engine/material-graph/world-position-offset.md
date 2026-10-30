# World position offset

**The world position offset** (`materials/graph/wpoProgram.ts`, `outputProgram.ts`,
`visibility/shader/wpoGraphWgsl.ts`, `wpoSets.ts`, `pageGeometryWgsl.ts`,
`geometry/rows/page/offsetRow.ts`, `frame/render/offsetReach.ts`). The `worldPositionOffset` output
(float3, zero by default, read by every surface, lit or not) compiles in the surface's program like
the others; the program restricted to it (`wpoOf`) is what the vertex-placing passes hold, chosen by
the program's key (its id, high bit set for a transparent pass's).

_Placement_: every page-geometry pass places a vertex with `pagePosition` (and `pagePreviousPosition`
for the image before), which adds the offset of `pageOffset` where the row's word says its surface
moves (`PageInfo.wpo`: `WPO_ROW_MOVES`; `WPO_ROW_VELOCITY` where the temporal pass reprojects by it;
`WPO_ROW_ALWAYS` where the surface evaluates whatever its object says). A brick of voxels takes the
offset at its box's centre for each corner and for the cells traced in it (`voxelCarry`), so it moves
rigidly. The tessellation's seeding, splitting and dicing place a patch's corners with `pagePosition`
too, so a displaced surface is diced on the moved triangle, the resolve's prism solve and the
velocity stage solving it on the same corners.

_Modules_: `pageWpoLocal` is a default of zero (a declaration marked weak, `wgslFn`'s `weak`, which
the assembler gives way to a same-named declaration); a module that evaluates offsets lists the real
one (`wpoGraphWgsl(wpoSet)`), so a module made without offsets is the page geometry's own, and every
module sees the same moved vertex: the hardware raster's vertex stage and voxel slots, the compute
raster, the tessellation, the surface resolve's graph classes, the shadow maps' depth raster, voxel
tiers and tessellated patches, the transparent pass's vertex stage (and front stage), the velocity
stage and the temporal pass's nearest velocity.

_Evaluation_: the offset is evaluated in the world from the vertex as the page and its deformation
place it (a texture it reads at the finest level, `textureSampleLevel`, the neighbours of its
footprint the vertex itself), held to the cluster's greatest offset (`wpoMost`), brought into the
primitive's space by the inverse of its world's linear part, and zero where the object does not
evaluate it: its disable distance (`wpoDisableSq`) measured from the camera (the graph frame's) to
the centre of its bounds (`wpoCentre`) unless a surface always evaluates. In a shadow pass
`wpoThreshold`, set from the projection record of the map it draws (`wpoThreshold`, a float at byte
292, `vsmWpoThreshold` in `vsm/clipmap.ts`), replaces the camera: the offset is evaluated where the
threshold is not past the object's distance. The threshold is the square of the distance past which
the clipmap level no longer shows the motion, the level held back by
`shadowClipmapWpoDisableDistanceLodBias` and the clipmap's whole resolution bias; a shift of it
redraws the level only with `shadowClipmapWpoDisableDistanceInvalidateOnScaleChange` on. It is zero
for a local light's map or with `shadowClipmapWpoDisableDistance` off. `previous` asks the same at
the clocks and camera of the image before, the object placed where the placement's motion says it
was (`wpoPreviousWorld`); whether it is evaluated is the current image's decision.

_What an object says_ of its offset is read once per change, never per image (`followOffsets`). Which
roots wear an offset the session holds is decided by their pages' surfaces and re-read when a
surface's offset facts moved (`MaterialTable.offsetEpoch`), the roots changed, a switch of any node
was written (`offsetSwitchEdits`) or the set of rasters grew. The image then walks the roots wearing
one, reads their node's switches (`objectOffsetRow`: `evaluateWorldPositionOffset`,
`worldPositionOffsetWritesVelocity`, `worldPositionOffsetDisableDistance`, `shadowCacheInvalidation`,
held in `RootOffsets`) and writes them into the placement's record (`PlacementInfo`). The decode
merges them with the cluster's own offset words (the surface's bits, zero where the object does not
evaluate its offset unless the surface always does) into the decoded cluster
(`visibility/decode/decodeWgsl.ts`; a transparent item carries the same words). It also tells the
shadow scheduler of the roots whose offset is evaluated now (`noteDeformed`): every one that casts
with `shadowCacheInvalidation` `always`, by its instance bounds alone, none with `rigid` or `static`.
`static` also keeps the object out of the moving casters (`MARK_BITS.cacheStatic`,
`MOBILITY_CACHE_STATIC`): the casters' diff (`lighting/shadows/casters/castDiffWgsl.ts`) stales
nothing for a pose change of a placement that was and is pinned; only an arrival, a departure or a
change of its other bits stales its pages.

_Reach_: a cluster whose bounds the offset may leave carries the surface's greatest offset as its
root's reach (`ClusterRoot.offsetReach`, added to the deformation's in `holdReach`/`holdOffsetReach`,
one writer): every cut grows the bounds of the root's pages by it, the CPU's and the GPU's by the
root's mark. The rays of the reflections and indirect light (`lighting/rays/`), the distance fields
and the screen probes' traces see the rest pose.
