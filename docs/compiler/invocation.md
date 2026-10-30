# Invocation

```
trillion3d-compiler source cache slice|full triangleBudget resourceBaseUrl
trillion3d-compiler source cache slice|full triangleBudget threads ramBudgetMb resourceBaseUrl
trillion3d-compiler source cache slice|full triangleBudget threads ramBudgetMb resourceBaseUrl simplification
trillion3d-compiler --jobs FILE|-
trillion3d-compiler --version
trillion3d-compiler --build-inputs
```

5, 7 or 8 positional arguments plus the flags below anywhere, the last of each kept
(`compiler/args.rs`). Flags are a job's fields in `JOB_FIELDS` order
(`packages/sdk-core/src/contracts/compilerAbi.ts`, printed into `shared_math/abi.rs`;
`meshBuildAbi.ts`, `objectAbi.ts` into `shared_math/abi/meshes.rs`). Invalid JSON or an out-of-range
value: `INVALID_OPTIONS` naming the field (`compiler/validate.rs`). Another argument count: usage,
`INVALID_ARGS`, exit 2. `--version` prints versions, drivers and platform as JSON. `--build-inputs`
prints the files hashed into the implementation hash (`build_inputs.rs`).

| Argument | Meaning | Default |
| --- | --- | --- |
| `source` | Folder with `manifest.json`, a `.gltf`/`.glb`, a file of [Input formats](input-formats.md#input-formats), or a folder of such files merged into one scene | required |
| `cache` | Output folder, created if missing; one source per cache (pruned after each compile) | required |
| `scope` | `slice` keeps whole mesh instances up to the triangle budget; `full` keeps everything | required |
| `triangleBudget` | Positive; `slice` only | required |
| `threads` | Worker threads, 1–64 | auto (every core; cores / workers in a batch) |
| `ramBudgetMb` | Admission budget, at least 64; a job estimated above it: `RAM_ADMISSION_BUDGET_EXCEEDED` | `4096` |
| `resourceBaseUrl` | URL prefix serving the source folder; relative image URIs rewritten against it | required |
| `simplification` | `qem-endpoints`: coarser levels above exact clusters; `none`: exact clusters alone, each a root; HLOD builds either way | `qem-endpoints` |
| `--textures-format=` | `all`, `bc7`, `astc` or `etc2`: GPU block families cooked beside stored BC, kept where they pass the quality gate ([FORMAT.md](../format/textures.md#textures)) | `bc7` |
| `--hlod=` | HLOD layers and assignment rules, JSON expert form ([HLOD](hlod.md#hlod)) | none |
| `--temporal-antialiasing=` | `off`, `low`, `medium`, `high`, `max`, `true` / `false` ([Temporal anti-aliasing](temporal-anti-aliasing.md#temporal-anti-aliasing)) | none |
| `--responsive=` | Objects with responsive materials, JSON: exact node name, `{ "regex", "flags" }`, or a match | none |
| `--materials=` | By material name, JSON `{ "name": { "responsive": "medium", "sky": true } }` ([A sky material](a-sky-material.md#a-sky-material)) | none |
| `--voxelize=` | Objects voxelized far away, same forms as `--responsive=` ([Voxels far away](voxels-far-away.md#voxels-far-away)) | none |
| `--partition-scheme=` | `hashSet`, `spatialHash` or `true` ([The partition's grids](the-partitions-grids.md#the-partitions-grids)) | `hashSet` |
| `--partition-grid=` | Main grid, JSON: `{ "cellSize", "loadingRange", "priority", "origin" }` and scheme settings; `true` defaults, `false` streaming off | 128 m cells loaded within 256 m, priority 0, centred on origin |
| `--partition-grids=` | JSON list of `partitionGrid` settings each with a `name`, first is default, not beside `--partition-grid=` ([Several streaming grids](the-partitions-grids.md#several-streaming-grids-partitiongrids)) | one grid |
| `--mesh-build=` | JSON: `{ "storedTangents", "keptTriangles", "trimmedError", "dropNearCollapsed", "alwaysResidentKib", "recomputeNormals", "recomputeTangents", "useMikkTSpace", "computeWeightedNormals", "skinnedWeldPosition", "skinnedWeldNormal", "skinnedWeldTexture", "positionPrecision", "normalPrecision", "tangentPrecision", "voxelRays", "voxelLevel", "voxelBackUp", "voxelSeparable", "voxelNdf", "voxelOpacity", "allowAssemblies", "distanceField", "distanceFieldScale", "distanceFieldTwoSided", "distanceFieldDensity", "distanceFieldMaxResolution", "maxMeshCards", "meshCardMinDensity", "meshCardNormalThreshold", "objects" }` ([Mesh build settings](how-a-mesh-coarsens.md#mesh-build-settings)) | no stored tangent, all triangles kept, no near-collapsed drop, one root page resident, normals rebuilt, MikkTSpace, skinned weld 200 nm, 2·10⁻⁵, 1/1024, density-following position grid, normals 8 bits an axis, tangents 7 bits, 64 voxel rays |
| `--lightmap-bake=` | JSON: `true` defaults, `false` none, or `{ "detailCellSize", "qualityMultiplier", "giSamples", "maxRefinementLevels", "irradianceCaching", "irradianceCacheQuality", "irradianceCacheSpacing", "irradianceCacheCornerRejection", "automaticVolumeExpand", "automaticVolumeLimit", "maximumBrickMemory", "sphericalHarmonicSmoothing", "loadingCellSize", "minBrickError", "skyLight", "volumes" }` ([Volumetric lightmap](volumetric-lightmap.md#volumetric-lightmap)) | no bake |
| `--object-settings=` | JSON: `{ "spatiallyLoaded", "skinnedInstance", "drawDistance", "runtimeGrid", "farField", "objects" }` ([Object settings](the-partitions-grids.md#object-settings)) | every object streams, no skinned instance |

```sh
trillion3d-compiler scenes/city/city.obj cache/city full 150000 8 8192 /assets/city/ qem-endpoints
```

A busy cache is waited for, then refused (`CACHE_LOCKED`); `TRILLION3D_CACHE_LOCK_WAIT_MS`, the only
environment variable read, sets the wait (ms; `0` refuses at once).
