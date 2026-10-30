# Simplified layers

A `simplify` layer (`builder: 'simplify'`) builds one actor per cell from the cell's original
objects — every object under the cell, whatever its level, never an actor of the level below —, step
by step, in centimetres and in a frame with `y` and `z` exchanged, as the method is written:

1. **Screen size and voxel.** The objects' bounding sphere seen where the actor is first drawn spans
   a share of a 1920-texel view, 45° half angle; that share times 1920, rounded, is the screen size
   in pixels. The voxel is `simplification.voxel`, else the bounds' largest side over the pixel
   count held from 50 to 900, times 1.95 / 3.
2. **Materials flattened.** A material whose look the mesh decides — a texture in a baked map, a
   vertex colour, a translucent material seen through (`translucency`) — is baked once per object
   wearing it, on the object's triangles at the texture set its meshes have at their lightmap index
   where `reuseLightmapUVs` (on by default) finds one on every primitive, else at coordinates
   generated for the whole object (the same unwrap a `merge` layer bakes on); every other material
   once, on a quad. With `groupIdenticalMeshes` the objects that place one mesh are one object,
   baked from the first of them: each other's primitive reads that bake and those coordinates at its
   own triangles. The bake's side is the layer's sizing over the objects' area and sphere, at the
   largest side a per-map sizing names; an image of one value shrinks to one texel.
3. **Volume.** The objects' signed distance field, two voxels of band each side, each voxel's
   nearest source triangle kept. With `gapWidth`, the gaps up to it are closed: the surface moved
   out by half of it in steps of at most 1.5 voxels (a coarser grid once more than `gapSteps` steps
   are needed), moved back, then eroded half a voxel more and united with the untouched field —
   doors and windows narrower than the distance come back plugged.
4. **Surface.** The surface half a voxel outside the sources, each vertex given its sources' normal
   where it leans within about 78° of its own, and drawn three quarters of the way onto its nearest
   source, so single-sided objects do not thicken.
5. **Simplification.** Quadric edge collapses priced on position and normal, the volume kept, until
   a collapse costs more than a cube of one pixel's span would — the bounds' diagonal over the pixel
   count — or a five-hundredth of the source triangles remains; in slabs across the bounds' largest
   axis first unless `serialSimplify`. `separateFoldedWalls` pushes apart faces the collapses folded
   into each other, a seventh of a voxel along their normals.
6. **Normals.** Angle-weighted normals, kept for the transfer's rays; the vertices split past
   `hardAngle` (under 179°); the normals again, weighed as `normalMethod` says.
7. **Charts and tangents.** The atlas sides are the layer's sizing over the simplified mesh's own
   area and sphere — one side, or each map's own with `biased` and `manual`, the grid the largest of
   them, at least 64 texels; the charts are packed for that grid. The mesh's bowties are broken
   (five passes at most), then it is cut by a spectral partition — any number of charts, each
   stretching 0.125 at most — and packed with `atlasGutter` texels between charts. A mesh that
   cannot be charted fails its actor. Each vertex then takes a tangent frame — the tangent along the
   atlas's `u`, the sign of its bitangent — from its normal and its triangles' texture coordinates,
   which the actor's pages store.
8. **Transfer.** Every texel of the grid, sixteen samples a texel, fires a ray each way along the
   kept normal, as far as `transferDistance` (six voxels by default, never under one voxel nor past
   the bounds' largest side); `transferRays: 'nearest'` keeps the nearer hit, `'facing'` prefers a
   source facing the ray's way. Each map is read from the hit's flattened images: the base colour
   bilinearly, its luminance kept as the samples average down, a sample no ray answers
   `unresolvedColor`; the coverage (`opacity` or `opacityMask`, the base image's alpha), the
   specular, roughness and metallic, and the emission, each averaged down from the samples a source
   answers, none for a sample no ray answers; the normal map decoded into world space, its samples'
   mean weighed by the inverse of a tenth plus the squared cosine each makes with the texel's
   normal, and written in the texel's tangent frame — the mesh's tangent and normal blended at the
   texel, the bitangent and the tangent made orthogonal to them with the handedness the corners'
   signs blend to — as the frame's inverse (its transpose where its determinant is a thousandth or
   less) takes the mean, made unit only when a component leaves [−1, 1]: a mean of normals that
   disagree stays shorter than one. Each map is then averaged down from the grid to its own side.
   The texels outside the charts take the nearest chart's values (`emptyTexels: 'nearestChart'`) or
   stay black.

The actor's material draws both faces when one of its sources' does and `allowDoubleSided` lets it.
A layer naming none of these settings builds exactly the method's defaults. An emission map holds
each source's emission over that source's own strength, and the actor's strength is the largest of
them. The method's `calculateCorrectLodModel` is not offered: every actor is built from the cell's
original objects at their level 0, whatever the distance it is drawn from, as every HLOD level is.

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
