# Simplified layers

A `simplify` layer (`builder: 'simplify'`) builds one actor per cell from the cell's original
objects (level 0, all under the cell), in centimetres, `y` and `z` exchanged:

1. **Screen size and voxel.** Screen size (pixels) = share of a 1920-texel view (45° half angle)
   spanned by the objects' bounding sphere where the actor is first drawn, x 1920, rounded. Voxel
   is `simplification.voxel`, else bounds' largest side over pixel count (held 50 to 900) x 1.95 / 3.
2. **Materials flattened.** A material whose look the mesh decides (texture in a baked map, vertex
   colour, `translucency`) is baked once per object wearing it, on its triangles at the meshes'
   lightmap-index texture set where `reuseLightmapUVs` (default on) finds one on every primitive,
   else at coordinates generated for the whole object (a `merge` layer's unwrap). Other materials
   are baked once, on a quad. With `groupIdenticalMeshes`, objects placing one mesh are one
   object, baked from the first. Bake side = layer's sizing over the objects' area and sphere.
3. **Volume.** Signed distance field, two voxels of band each side, each voxel's nearest source
   triangle kept. With `gapWidth`, gaps up to it are closed: surface moved out by half of it in
   steps of at most 1.5 voxels (coarser grid past `gapSteps` steps), moved back, eroded half a
   voxel more, united with the untouched field.
4. **Surface.** Half a voxel outside the sources; a vertex takes its sources' normal where within
   about 78° of its own, and is drawn three quarters of the way onto its nearest source.
5. **Simplification.** Quadric edge collapses, volume kept, until a collapse costs more than a
   cube of one pixel's span (bounds' diagonal over pixel count) or 1/500 of the source triangles
   remains; slabs across the largest axis first unless `serialSimplify`. `separateFoldedWalls`
   pushes folded faces apart by 1/7 voxel.
6. **Normals.** Angle-weighted; split past `hardAngle` (under 179°); again per `normalMethod`.
7. **Charts and tangents.** Atlas sides are the layer's sizing over the simplified mesh's area and
   sphere (one side, or each map's own with `biased` and `manual`); grid = largest, at least 64
   texels. Bowties broken (five passes at most), spectral partition into charts (stretch 0.125 at
   most), packed with `atlasGutter` texels between. A mesh that cannot be charted fails its actor.
   Each vertex's tangent frame (tangent along the atlas's `u`, bitangent sign) comes from its normal
   and its triangles' texture coordinates.
8. **Transfer.** Every texel, sixteen samples a texel, fires a ray each way along the kept normal
   up to `transferDistance` (default six voxels; clamped one voxel to the bounds' largest side);
   `transferRays: 'nearest'` keeps the nearer hit, `'facing'` prefers a source facing the ray.
   - base colour bilinear; a sample no ray answers gets `unresolvedColor`
   - coverage (`opacity` or `opacityMask`, base alpha), specular, roughness, metallic, emission:
     averaged from the samples a source answers
   - normal map: world space; samples weighed by 1 / (0.1 + squared cosine with the texel's
     normal), written in the texel's tangent frame, made unit only when a component leaves [−1, 1]

   Texels outside the charts take the nearest chart's values (`emptyTexels: 'nearestChart'`) or
   stay black.

The actor's material is double-sided when a source's is and `allowDoubleSided` lets it.
The method's `calculateCorrectLodModel` is not offered: every actor is built from the cell's
original objects at level 0.

```ts
await prepare(source, cache, 'slice', 150000, {
  hlod: {
    layers: [
      { name: 'buildings', builder: 'instanced', parent: 'far' },
      {
        name: 'far',
        builder: 'simplify',
        textureSize: 1024,
        textureSizing: 'biased',
        maps: { normal: true, roughness: true, emissive: true },
        groupIdenticalMeshes: true,
        simplification: { gapWidth: 2, hardAngle: 80, transferRays: 'nearest' },
      },
    ],
    default: 'buildings',
  },
})
```

The same layer from the command line:
`trillion3d-compile '--hlod={"layers":[{"name":"buildings","builder":"instanced","parent":"far"},{"name":"far","builder":"simplify","simplification":{"gapWidth":2,"hardAngle":80}}],"default":"buildings"}' …`.
