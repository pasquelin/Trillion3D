# Global distance field settings

`world.globalDistanceField`: global distance field settings, also a `createWorld` option: clipmaps
composited from meshes' distance fields around the camera (a mesh has one where its build sets
`distanceField`, [COMPILER.md](../../compiler/distance-fields.md#distance-fields)) and the brick
atlas they stream into ([ENGINE.md](../../engine/distance-fields.md#distance-fields)). Lengths in
centimetres. Each setting is the reference console variable of that name, with its default.

## Clipmaps and updates

- `globalDistanceField` (`true`), `globalDistanceFieldUpdate` (`true`).
- `globalDistanceFieldClipmaps` (`4`, at most 6), `globalDistanceFieldViewDistance` (`20000`),
  `globalDistanceFieldClipmapExponent` (`2`), `globalDistanceFieldResolution` (`128`),
  `globalDistanceFieldMipFactor` (`4`), `globalDistanceFieldOccupancyRatio` (`0.3`).
- `globalDistanceFieldCacheMostlyStaticSeparately` (`true`), `globalDistanceFieldPartialUpdates`
  (`true`), `globalDistanceFieldStaggeredUpdates` (`true`), `globalDistanceFieldUpdatesPerFrame`
  (`2`), `globalDistanceFieldForceFullUpdate` (`false`), `globalDistanceFieldForceUpdateOnce`
  (`false`).
- `globalDistanceFieldFastCameraMode` (`false`), `globalDistanceFieldCameraVelocityDecay` (`0.7`),
  `globalDistanceFieldAverageCulledObjectsPerCell` (`512`).
- `globalDistanceFieldRecacheOnStreaming` (`true`), `globalDistanceFieldForceRecacheOnStreaming`
  (`false`).
- `globalDistanceFieldDebugShowStats` (`false`): writes page stats over the image's upper right:
  atlas maximum, allocated, free; clipmap pages in use, those without surface, pages composited
  this image (`world.globalDistanceField = { globalDistanceFieldDebugShowStats: true }`, `null` back
  to off).
- `globalDistanceFieldStartDistance` (`100`), `globalDistanceFieldMinMeshRadius` (`20`),
  `globalDistanceFieldMinMeshRadiusInVoxels` (`0.5`).

## Rays the reflections march through the field

- `globalDistanceFieldTraceResolution` (`252`), `globalDistanceFieldTraceClipmapExtent` (`2500`):
  voxels along a clipmap and first clipmap's half-extent while rays are marched; each next clipmap
  twice the previous.
- `globalDistanceFieldTraceViewDistance` (`20000`): scene distance then. The field makes one clipmap
  beyond `globalDistanceFieldClipmaps` where the next's extent reaches it, two where the one after
  does (default four clipmaps of 2500 become five at `40000`, six at `80000`).
- While rays are marched (reflection default), `globalDistanceFieldViewDistance`,
  `globalDistanceFieldClipmapExponent` and `globalDistanceFieldResolution` do nothing.
- `globalDistanceFieldCoveredExpandSurfaceScale` (`1`),
  `globalDistanceFieldNotCoveredExpandSurfaceScale` (`0.6`): scale of the half voxel a ray expands
  the met surface by, in pages meshes cover and in those only two-sided meshes (foliage) reach.
- `globalDistanceFieldSimpleCoverageBasedExpand` (`false`): `true` counts the whole page not
  covered, coverage atlas unread.
- `globalDistanceFieldNotCoveredMinStepScale` (`4`): scale of its least step there.
- `globalDistanceFieldDitheredTransparencyStepThreshold` (`0.5`),
  `globalDistanceFieldDitheredTransparencyTraceThreshold` (`0.9`): noise under which a dithered ray
  stops there.

## The atlas and run-time fields

- `meshDistanceFieldMaxObjectRadius` (`100000`), `meshDistanceFieldSurfaceBiasExpand` (`0.25`),
  `meshDistanceFieldBrickAtlasSize` (`128`, power of two, read at atlas creation),
  `meshDistanceFieldBrickAtlasDepth` (`32`), `meshDistanceFieldUploadKiB` (`8192`),
  `meshDistanceFieldBlockBricks` (`16`, read at atlas creation), `meshDistanceFieldForceMips` (`0`:
  follow the view; 1 to 3 loads that many mips of every mesh), `meshDistanceFieldReverseAllocation`
  (`false`).
- `runtimeMeshDistanceFields` (`false`): a run-time mesh without compiler field gets one built on
  appearing, on the GPU, by the compiler's program (nearest triangle within the band, 98 rays for
  sign; doubtful voxels remeasured on the CPU).
  - Read when the scene's page records are made and each image after; set with the other options
    before the scene opens.
  - One build per distinct mesh, in short chunks; marched rays meet the mesh a few frames after it
    appears.
  - Deforming meshes, meshes without ray-tracing tree, and meshes too deep for the program get none.
  - Reference builds fields at import only.

A write names changed settings, `null` restores a default; a value of another kind is refused by
name.

```js
const world = createWorld('viewer', { globalDistanceFieldClipmaps: 5 }) // one more clipmap
world.globalDistanceField = {
  globalDistanceFieldViewDistance: 40000,
  meshDistanceFieldUploadKiB: 16384,
}
world.globalDistanceField = { globalDistanceFieldFastCameraMode: true } // follow a fast camera, lower quality
world.globalDistanceField = { globalDistanceFieldFastCameraMode: null } // back to the default, off
// A cheaper march for the reflections: coarser clipmaps while rays are marched
world.globalDistanceField = { globalDistanceFieldTraceResolution: 140 }
// A scene kept to 800 m while rays are marched: the field grows from four clipmaps to six
world.globalDistanceField = { globalDistanceFieldTraceViewDistance: 80000 }
// Meshes made at run time (a generated terrain, a procedural prop) take part in the marched rays too
world.globalDistanceField = { runtimeMeshDistanceFields: true }
// Cheaper still, a page foliage reaches counted as not covered whole, the coverage atlas unread
world.globalDistanceField = { globalDistanceFieldSimpleCoverageBasedExpand: true }
```
