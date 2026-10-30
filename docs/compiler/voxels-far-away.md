# Voxels far away

A voxelized mesh's DAG continues in voxels where they hold error better than triangles: from that
level up, each group is bricks of 4³ voxels, a voxel one pixel wide where the cut draws it
(`asset-compiler-rust/src/voxel`).

- Each voxel is crossed by `voxelRays` (64 default) rays against the mesh's level-0 triangles
  through their materials; a cut texel lets a ray through.
- Least covered voxels hand coverage to neighbours until no more remain than coverage sums to.
- A voxel keeps prefiltered base colour, occlusion, roughness, metalness, its normal distribution
  fitted to a lobe about an axis (`voxelNdf`) and, for a skinned mesh, its brick's joint.

The engine draws each brick as its box and traces its voxels per pixel.

A mesh is voxelized by the first source naming it:

1. `voxelize` (`--voxelize=`, `jobs[].voxelize`): meshes of every object the match takes, read as
   `responsive` reads its match;
2. the HLOD: meshes of every object whose layer's chain has a `voxel` layer (expert form's layers);
3. the mesh's glTF `extras`, `"extras": { "shapePreservation": "voxelize" }`.

Named is not forced: a group goes voxel only when its voxels beat its triangles, and every group
above it then too. The `voxel` layer voxelizes each cell's objects together, whatever each mesh did.

A `voxel` layer (`builder: 'voxel'`; its `meshBuild` names voxel sampling,
[below](#how-voxels-are-sampled)) builds one actor per cell: the cell's original objects voxelized
together from the pixel where the cell is first seen, each level twice the one below until one brick
holds the cell; no shell, no atlas. Actors are static; only voxels follow joints.

```ts
await prepare(source, cache, 'slice', 150000, {
  resourceBaseUrl: '/assets/park/',
  hlod: {
    layers: [
      { name: 'trees', builder: 'instanced', parent: 'canopy' },
      { name: 'canopy', builder: 'voxel', spatiallyLoaded: false },
    ],
    assign: [{ match: { mesh: /tree|bush/i }, layer: 'trees' }],
  },
  voxelize: { mesh: /hedge/i },
})
```

Command line: `trillion3d-compile '--hlod={"layers":[{"name":"canopy","builder":"voxel"}]}' '--voxelize={"mesh":{"regex":"hedge","flags":"i"}}'`.
A `voxelize` naming nothing, or a regex that doesn't compile, refuses the job (`INVALID_OPTIONS`).
Runtime `voxels` view: voxels in level colours, triangles grey.

## How voxels are sampled

Six `voxel…` settings of `meshBuild` set how voxels are sampled. A mesh reads each from: first rule
of `meshBuild.objects` matching one of its objects, then `meshBuild`'s own, then mesh `extras`, then
the default shown [above](how-a-mesh-coarsens.md#mesh-build-settings). Naming none keeps the cache key.

- A `merge` or `simplify` layer's `meshBuild` names none of them (its shape preservation stays
  `none` or `area`; far voxels are a `voxel` layer's).
- A `voxel` layer's `meshBuild` names these six alone; `voxelLevel` does nothing there.

```json
{
  "voxelize": { "node": { "regex": "^Tree" } },
  "meshBuild": {
    "voxelRays": 128,
    "objects": [
      { "match": { "node": { "regex": "^Hedge" } }, "voxelRays": 16, "voxelOpacity": true },
      { "match": { "node": { "regex": "^Tower" } }, "voxelLevel": 2, "voxelNdf": false }
    ]
  }
}
```

Meshes cast 128 rays per voxel; hedges 16, keeping every ray-hit voxel; towers are voxels from the
second level up, keeping only each mean normal's direction.

From Node: `prepare(source, cache, 'slice', budget, { resourceBaseUrl, voxelize: /^Tree/, meshBuild:
{ voxelRays: 128, objects: [{ match: /^Hedge/, voxelRays: 16 }] } })`. Command line: `--mesh-build={"voxelRays":128}`; on a mesh, `"extras": { "shapePreservation":
"voxelize", "voxelRays": 32, "voxelNdf": false }`.

A voxel layer's own sampling:

```json
{
  "hlod": {
    "layers": [
      { "name": "far", "builder": "voxel", "meshBuild": { "voxelRays": 32, "voxelNdf": false } }
    ]
  }
}
```

- Under 32 rays (rounded to a multiple of 16), a `voxel` layer's resampled cells include no-hit
  ones; from 32 only cells a ray hit, or given coverage, are resampled.
- `voxelOpacity` keeps every ray-hit voxel, handing over no coverage.
- A wrong-kind setting (also in `extras`) refuses the job (`INVALID_OPTIONS`).
