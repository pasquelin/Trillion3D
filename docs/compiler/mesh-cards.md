# Mesh cards

A mesh whose build keeps cards (`maxMeshCards` above 0, default 12) gets them from its level-0
triangles, in centimetres, written in `meshCards.bin` (`card_representation/`), named by the
manifest's `meshCards` section ([FORMAT.md](../format/meshcardsbin.md#meshcardsbin)); none, nothing
written. A card is a box looking at the mesh along one of six axis directions.

1. **Volume.** The mesh's box (its distance field's where present), grown 1 cm each side, cut in
   10 cm voxels, larger so no side holds more than 64.
2. **Surfels.** Per direction, 32 jittered rays per column run against the direction from two
   voxels before the volume, continuing past each surface. A surface facing the direction
   (`meshCardNormalThreshold`; two-sided back counts as front), in a cell beyond the one after the
   last, is a sample. Samples of a cell seen from the same cell become surfels:
   cell, coverage (share of column rays), first visible cell. A surfel inside geometry is
   dropped: of 25 rays over its normal's hemisphere, more than 0.8 hit and more than 0.2 hit a
   one-sided back face. Weighted coverage = coverage times (1 + share of rays leaving the mesh).
   Above 10 000 surfels over six directions, re-cut with half the voxels a side, until fewer.
3. **Clusters.** Each direction's surfels seen from outside make a cluster; for a mesh not mostly
   two-sided, the most covering cluster of the surfels from some cell on is added while valid.
   Valid: weighted coverage reaches 15 cells (outer cluster: 15 or half the mean volume-face
   area, the less) and coverage over its box's face area exceeds a third of `meshCardMinDensity`.
   The most covering clusters of all directions are kept, up to `maxMeshCards`.
4. **Cards.** A cluster's box, half a voxel further at each ray end, within the mesh's box +10 cm.

`meshCards.bin` also holds each HLOD cell's cards (`layers[].allowDistanceField` either way,
[HLOD](hlod.md#hlod)), from its actors in world space at the job's `meshBuild` settings.

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

On a mesh: `"extras": { "maxMeshCards": 0 }`. A wrong kind or out-of-range value: `INVALID_OPTIONS`.
