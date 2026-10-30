# Mesh cards

A mesh whose build keeps cards (`maxMeshCards` above 0, 12 by default: the reference's) gets them
found from its level-0 triangles, in the centimetre, and written in `meshCards.bin`
(`card_representation/`), which the manifest's `meshCards` section names
([FORMAT.md](../format/meshcardsbin.md#meshcardsbin)); a scene whose meshes keep none writes
neither. A card is a box looking at the mesh along one of the six axis directions: the few of them
that cover a mesh are what a surface cache captures the mesh into. The mesh is read as its distance
field is, but for the triangles of a blended material, which the cards keep.

1. **The volume.** The mesh's box, or its distance field's where it has one, grown by a centimetre
   each side (and by at least one centimetre of half-extent), is cut in voxels of 10 cm, or larger
   so that no side holds more than 64.
2. **The surfels.** For each of the six directions, 32 rays run through each column of the volume,
   jittered across its face, against the direction, from two voxels before the volume, and go on
   past each surface they meet, from the start of the cell after the one it lies in. A surface that
   faces the direction squarely enough (`meshCardNormalThreshold`; the back of a two-sided surface
   counts as its front) and lies in a cell beyond the one after the last becomes a sample. The
   samples of a cell, in runs seen from the same cell along the rays, become its surfels: a cell,
   its coverage (the share of the column's rays) and the cell along the rays from which it is first
   visible. A surfel is dropped when it lies inside geometry: of 25 rays over the hemisphere about
   its normal, more than 0.8 hit and more than 0.2 hit a back face of a one-sided material. The
   weighted coverage of a surfel is its coverage times one plus the share of those rays that leave
   the mesh. When the surfels of the six directions are more than 10 000, the volume is cut again
   with half the voxels a side, until they are fewer or the side holds a voxel.
3. **The clusters.** Each direction's surfels seen from outside make a cluster; for a mesh that is
   not mostly two-sided, again and again the most covering cluster of the surfels from some cell
   along the rays on is added, while one is valid. A cluster is valid when its weighted coverage
   reaches 15 cells (the outer cluster's, 15 or half the mean area of a face of the volume, the
   less) and its coverage over the area of its box's face exceeds a third of `meshCardMinDensity`.
   The most covering clusters of the six directions are kept, up to `maxMeshCards`.
4. **The cards.** A card is a cluster's box, half a voxel further at each end of the rays, held
   within the mesh's box (10 cm past it along the rays at most).

The cards are the same at every run, whatever the threads. Besides each compiled mesh's cards,
`meshCards.bin` holds those of each HLOD cell, whether its layer allows a distance field
(`layers[].allowDistanceField`, [HLOD](hlod.md#hlod)) or not, found from the cell's actors together
in the world's space at the settings of the job's own `meshBuild`, fitted in the cell's field box
where it has one.

```json
{
  "meshBuild": {
    "maxMeshCards": 6,
    "objects": [
      { "match": { "node": { "regex": "^Tree" } }, "maxMeshCards": 20, "meshCardMinDensity": 0.1 },
      { "match": { "node": { "regex": "^Rubble" } }, "maxMeshCards": 0 }
    ]
  }
}
```

Here every mesh keeps at most 6 cards, the trees up to 20 with a card kept at a tenth of the default
density, and the rubble none. On a mesh, `"extras": { "maxMeshCards": 0 }`. A setting of the wrong
kind or out of its range refuses the job (`INVALID_OPTIONS`).
