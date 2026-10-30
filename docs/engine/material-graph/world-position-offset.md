# World position offset

**The world position offset** (`materials/graph/wpoProgram.ts`, `outputProgram.ts`,
`visibility/shader/wpoGraphWgsl.ts`, `wpoSets.ts`, `pageGeometryWgsl.ts`,
`geometry/rows/page/offsetRow.ts`, `frame/render/offsetReach.ts`). The `worldPositionOffset` output
(float3, zero by default, read by every surface, lit or not) compiles in the surface's program; the
program restricted to it (`wpoOf`) is what the vertex-placing passes hold, keyed by the program's id
(high bit set for a transparent pass's).

_Placement_: page-geometry passes place a vertex with `pagePosition` (`pagePreviousPosition` for the
image before), adding `pageOffset` where the row's word says its surface moves (`PageInfo.wpo`:
`WPO_ROW_MOVES`; `WPO_ROW_VELOCITY` where the temporal pass reprojects by it; `WPO_ROW_ALWAYS`
where the surface evaluates whatever its object says). A voxel brick takes the offset at its box's
centre (`voxelCarry`). Tessellation seeding, splitting and dicing use `pagePosition` too.

_Modules_: `pageWpoLocal` is a zero weak default (`wgslFn`'s `weak`); a module evaluating offsets
lists the real one (`wpoGraphWgsl(wpoSet)`); all vertex-placing modules see the same moved vertex.

_Evaluation_: in the world from the vertex as the page and its deformation place it (textures at the
finest level, `textureSampleLevel`), held to the cluster's greatest offset (`wpoMost`), brought into the primitive's space
by the inverse of its world's linear part, and zero where the object does not evaluate it: its
disable distance (`wpoDisableSq`) from the camera to the centre of its bounds (`wpoCentre`), unless
a surface always evaluates.

- In a shadow pass `wpoThreshold`, from the map's projection record (a float at byte 292,
  `vsmWpoThreshold` in `vsm/clipmap.ts`), replaces the camera: the offset is evaluated where the
  threshold is not past the object's distance. It is the squared distance past which the clipmap
  level no longer shows the motion, held back by `shadowClipmapWpoDisableDistanceLodBias` and the
  clipmap's resolution bias; a shift of it redraws the level only with
  `shadowClipmapWpoDisableDistanceInvalidateOnScaleChange` on. Zero for a local light's map or with
  `shadowClipmapWpoDisableDistance` off.
- `previous` evaluates at the clocks, camera and object placement of the image before
  (`wpoPreviousWorld`); the current image decides whether it is evaluated.

_What an object says_ of its offset is read once per change (`followOffsets`).

- Which roots wear an offset follows their pages' surfaces, re-read when offset facts moved
  (`MaterialTable.offsetEpoch`), the roots changed, a node's switch was written
  (`offsetSwitchEdits`) or the set of rasters grew.
- The switches of those roots (`objectOffsetRow`: `evaluateWorldPositionOffset`,
  `worldPositionOffsetWritesVelocity`, `worldPositionOffsetDisableDistance`,
  `shadowCacheInvalidation`; `RootOffsets`) go into the placement's record (`PlacementInfo`) and are
  merged with the cluster's offset words by the decode (`visibility/decode/decodeWgsl.ts`).
- The shadow scheduler gets the roots whose offset is evaluated now (`noteDeformed`): every one
  casting with `shadowCacheInvalidation` `always` (by instance bounds alone), none with `rigid` or
  `static`. `static` also keeps the object out of the moving casters (`MARK_BITS.cacheStatic`,
  `MOBILITY_CACHE_STATIC`): the casters' diff (`lighting/shadows/casters/castDiffWgsl.ts`) ignores a
  pose change of a pinned placement.

_Reach_: a cluster whose bounds the offset may leave carries the surface's greatest offset as its
root's reach (`ClusterRoot.offsetReach`, added to the deformation's in `holdReach`,
`holdOffsetReach`): every cut grows the root's page bounds by it. The rays of the reflections and indirect
light
(`lighting/rays/`), the distance fields and the screen probes' traces see the rest pose.
