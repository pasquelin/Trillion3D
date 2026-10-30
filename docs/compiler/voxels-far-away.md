# Voxels far away

Far away a tree's leaves are thinner than a pixel: simplified triangles drop them at random, a
shell closes them into a blob that loses their cut-outs. A voxelized mesh's DAG goes on in voxels
where they hold the error better than its triangles: from that level up each group is bricks of
4³ voxels, a voxel one pixel wide where the cut draws it — no cross-fade, no pop, nothing authored
(`asset-compiler-rust/src/voxel`). Each voxel is crossed by `voxelRays` (64 by default) rays of
every direction against the mesh's level-0 triangles through their materials — a cut texel lets a
ray through, so a leaf card's cut-out thins the voxel as it thins the pixel —; the least covered
voxels hand their coverage to their neighbours until no more are left than the coverage sums to, so
a crown stays as dense as its leaves ([How voxels are sampled](#how-voxels-are-sampled) sets each
of these steps). A voxel keeps its prefiltered base colour, occlusion, roughness and metalness, the
distribution of its normals fitted to a lobe about an axis (`voxelNdf`), from which the engine draws
each pixel's shading normal anew every image, and, for a skinned mesh, its brick's joint, so wind
bending a tree's bones bends its voxels. The engine draws each brick as its box and traces its voxels pixel by pixel.

A mesh is voxelized, the first source naming it winning:

1. `voxelize` (`--voxelize=`, `jobs[].voxelize`) — the meshes of every object the match takes, read
   as `responsive` reads its match;
2. the HLOD — the meshes of every object whose layer's chain has a `voxel` layer (the expert
   form's layers);
3. the mesh's own glTF `extras`, `"extras": { "shapePreservation": "voxelize" }`.

Named is not forced: this per-mesh far field follows the one rule above — a group goes voxel only
when its voxels beat its triangles, and every group above it then too —, so a small mesh whose
triangles always hold the error stays triangles to its top. The `voxel` layer is apart: it
voxelizes each cell's objects together, whatever each mesh did.

A `voxel` layer (`builder: 'voxel'`; its `meshBuild` names how its voxels are sampled, [below](#how-voxels-are-sampled)) builds one actor per cell: the cell's original
objects voxelized together from the pixel where the cell is first seen, every level twice the one
below until one brick holds the cell, no shell and no atlas — at every HLOD level, every object
under the cell, never the actors of the level below.
Its actors are static: only an object's own voxels follow its joints.

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

The same job from the command line:
`trillion3d-compile '--hlod={"layers":[{"name":"trees","builder":"instanced","parent":"canopy"},{"name":"canopy","builder":"voxel","spatiallyLoaded":false}],"assign":[{"match":{"mesh":{"regex":"tree|bush","flags":"i"}},"layer":"trees"}]}' '--voxelize={"mesh":{"regex":"hedge","flags":"i"}}' …`.
A `voxelize` naming nothing, or a regular expression that does not compile, refuses the job
(`INVALID_OPTIONS`), as `responsive` does. The runtime's `voxels` view paints each voxel in its
level's colour, the triangles in grey.

## How voxels are sampled

The six `voxel…` settings of `meshBuild` say how the voxels of a voxelized mesh — one a `voxelize`
match, its own glTF `extras` (`shapePreservation: "voxelize"`) or the job names — are sampled. Like
every mesh build setting each is read, for a mesh, from the first rule of `meshBuild.objects` that
matches one of its objects, then `meshBuild`'s own setting, then the mesh's `extras`, then the
default shown [above](how-a-mesh-coarsens.md#mesh-build-settings); a job naming none keeps its cache key and samples every
voxel as before. A `merge` or `simplify` layer's `meshBuild` names none of them (its shape
preservation stays `none` or `area`: voxels far away are a `voxel` layer's). A `voxel` layer's
`meshBuild` names these six alone, for the voxels of its cells, as the merged and proxy meshes of a
layer carry their own settings; `voxelLevel` changes nothing there, every level of a cell being
voxels. A voxel layer naming none samples every cell by the defaults.

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

Here every voxelized mesh casts 128 rays per voxel; the hedges cast 16 and keep every voxel a ray
hit, with its coverage as opacity; the towers draw every group from the second level up as voxels
and keep only the direction of each voxel's mean normal.

From Node, `prepare(source, cache, 'slice', budget, { resourceBaseUrl, voxelize: /^Tree/, meshBuild:
{ voxelRays: 128, objects: [{ match: /^Hedge/, voxelRays: 16 }] } })`; on the command line,
`trillion3d-compile '--mesh-build={"voxelRays":128}' …`; on a mesh, `"extras": { "shapePreservation":
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

- A count of rays under 32 (after the rounding to a multiple of 16) is too few to tell that a voxel
  no ray hit holds nothing: the cells of a `voxel` layer sampled again one level up then include
  those no ray hit. From 32 rays only the cells a ray hit, or whose coverage was handed over, are
  sampled again. A mesh's voxels are byte-identical under the defaults; a `voxel` layer's upper
  levels follow that rule.
- `voxelOpacity` keeps every voxel a ray hit and hands no coverage over; the voxel record holds no opacity.
- A setting of the wrong kind refuses the job (`INVALID_OPTIONS`), a mesh's `extras` one too.
