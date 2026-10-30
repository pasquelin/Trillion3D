# Global distance field settings

`world.globalDistanceField` holds the settings of the global distance field, also a `createWorld`
option: the clipmaps composited from the meshes' distance fields around the camera (a mesh has one
where its build sets `distanceField`, [COMPILER.md](../../compiler/distance-fields.md#distance-fields))
and the brick atlas those fields are streamed into
([ENGINE.md](../../engine/distance-fields.md#distance-fields)). Lengths are in centimetres. Each setting
is the reference's console variable of that name with its default.

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
- `globalDistanceFieldDebugShowStats` (`false`) writes over the upper right of the image the pages of
  the field: the most the atlas holds, those allocated and free, the pages of the clipmaps in use
  (combined), those among them with no surface and the pages composited this image
  (`world.globalDistanceField = { globalDistanceFieldDebugShowStats: true }`, `null` back to off).
- `globalDistanceFieldStartDistance` (`100`), `globalDistanceFieldMinMeshRadius` (`20`),
  `globalDistanceFieldMinMeshRadiusInVoxels` (`0.5`).

## Rays the reflections march through the field

- `globalDistanceFieldTraceResolution` (`252`) and `globalDistanceFieldTraceClipmapExtent` (`2500`):
  the voxels along a clipmap and the first clipmap's half-extent while rays are marched, each next
  clipmap twice the one before.
- `globalDistanceFieldTraceViewDistance` (`20000`): the distance the scene is kept to then. The field
  makes one clipmap more than `globalDistanceFieldClipmaps` where the extent of the next reaches it,
  two more where the one after does (the default four clipmaps of 2500 become five at `40000` and
  six at `80000`).
- While rays are marched, which the reflections do by default, `globalDistanceFieldViewDistance`,
  `globalDistanceFieldClipmapExponent` and `globalDistanceFieldResolution` have no effect: the three
  above size the clipmaps in their place.
- `globalDistanceFieldCoveredExpandSurfaceScale` (`1`) and
  `globalDistanceFieldNotCoveredExpandSurfaceScale` (`0.6`): the scale of the half voxel by which a
  ray expands the surface it meets in the pages the meshes cover and in those only two-sided meshes
  (foliage) reach.
- `globalDistanceFieldSimpleCoverageBasedExpand` (`false`) reads the coverage atlas, the coverage of
  each voxel of such a page; `true` counts the whole page as not covered and leaves the atlas unread.
- `globalDistanceFieldNotCoveredMinStepScale` (`4`): the scale of its least step there.
- `globalDistanceFieldDitheredTransparencyStepThreshold` (`0.5`) and
  `globalDistanceFieldDitheredTransparencyTraceThreshold` (`0.9`): the noise under which a dithered
  ray is stopped there.

## The atlas and run-time fields

- `meshDistanceFieldMaxObjectRadius` (`100000`), `meshDistanceFieldSurfaceBiasExpand` (`0.25`),
  `meshDistanceFieldBrickAtlasSize` (`128`, a power of two, read when the atlas is made),
  `meshDistanceFieldBrickAtlasDepth` (`32`), `meshDistanceFieldUploadKiB` (`8192`),
  `meshDistanceFieldBlockBricks` (`16`, read when the atlas is made), `meshDistanceFieldForceMips`
  (`0`: follow the view; 1 to 3 loads that many mips of every mesh) and
  `meshDistanceFieldReverseAllocation` (`false`).
- `runtimeMeshDistanceFields` (`false`): a mesh made at run time, which no compiler gave a field,
  gets one built when it appears, on the page's GPU, by the compiler's own program (the same text,
  the same steps: the nearest triangle within the band, the 98 rays across the sphere for the sign;
  the voxels the device is in doubt of are measured again on the CPU, so the field is the
  compiler's).
  - It is read when the scene's page records are made (a mesh cut at run time is flagged as having a
    field then) and each image after; set it with the world's other options before the scene opens.
  - It costs the build once for each distinct mesh, in chunks short enough for the page's frames to
    go on, and the rays marched through the field meet the mesh a few frames after it appears.
  - A mesh that deforms, one with no ray-tracing tree and one too deep for the program to walk get
    none.
  - The reference builds fields at import only, so the setting is off until a scene asks for it.

A write names the settings it changes, `null` one's default; a value of another kind is refused by
name. A scene whose meshes built no distance field, and none asked for them at run time, is not
touched.

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
