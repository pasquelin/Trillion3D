# Layer settings

The expert form, every layer setting:

```ts
hlod: {
  layers: [
    { name: 'buildings', builder: 'instanced', parent: 'city1' },
    { name: 'city1', builder: 'approximate', parent: 'city2', deviation: 0.05, cellSize: 512, loadingRange: 1024 },
    { name: 'city2', builder: 'approximate', textureSize: 2048, spatiallyLoaded: false },
    { name: 'trees', builder: 'instanced', parent: 'canopy' },
    { name: 'canopy', builder: 'approximate', accuracy: 0.5 },
  ],
  assign: [{ match: { node: /^Tree/, extras: { kind: 'tree' } }, layer: 'trees' }],
  default: 'buildings',
}
```

| Field | Meaning |
| - | - |
| `layers[].name` | Unique name |
| `layers[].builder` | `instanced` (the objects themselves, each at the last LOD of its mesh with `clusterDag: false`), `approximate` (one closed shell per cell, materials baked), `merge` (cell's objects merged into one mesh), `voxel` (cell's objects voxelized: [Voxels far away](../voxels-far-away.md#voxels-far-away)), `simplify` (objects remeshed through their volume, materials transferred onto an atlas: [Simplified layers](simplified-layers.md#simplified-layers)) |
| `layers[].parent` | Layer whose cells' actors this layer builds; none at a chain's top, whose actors are always loaded. An `instanced` layer, or a `merge` layer keeping its materials, builds nothing above a layer whose actors wear materials of their own |
| `layers[].spatiallyLoaded` | Actors stream on a grid of their own; `false`: always loaded, nothing built above them (no `parent`), no `cellSize` nor `loadingRange`; an `instanced` layer's objects (`clusterDag` left `true`) stay loaded with the scene; default `true` |
| `layers[].cellSize`, `loadingRange` | Under the `spatialHash` scheme ([The partition's grids](../the-partitions-grids.md#the-partitions-grids)): side of the finest cell and load distance; metres, above 0; layers of one level, cell and range share a grid (priority 100 + level); default 256 m and 512 m. `hashSet` ignores them: level `i` uses a grid of `2 << i` times the main cell and range |
| `layers[].accuracy` | `approximate` voxel, metres; the grid holds the cell's diagonal over it, 64 voxels to `voxelClamp`; default 1 m |
| `layers[].deviation` | `approximate` shell simplification bound, metres; 0.1 |
| `layers[].textureSize` | Atlas side of an `approximate` layer, or of a `merge` layer merging materials or a `simplify` layer sized `fixed` or `biased`; power of two, 16 to 8192; default 1024 |
| `layers[].approximation` | `approximate` steps, each its default when left out: `voxelClamp` (most voxels across, 64–1290, 1024); `autoThicken` (true), `thicknessMultiplier` (voxels, 1.5); `ignoreTinyParts` (true), `tinyPartMultiplier` (0.05); `windingThreshold` (0.01–0.99, 0.5); `fillGaps` (true), `gapDistance` (metres, 0.1); `occlusion` (`visibility` or `none`), `occludeFromBelow` (true); `simplification` (`geometricTolerance` to `deviation`, `trianglesPerArea` to `trianglesPerSquareMetre` (0.01 to float max, 2), `fixedTriangleCount` to `triangleCount` (16–2147483647, 2000)), `simplifyPrePass` (true); `hardNormals` (true), `hardNormalAngle` (degrees, 60); `uvMethod` (`charts`, `patches` or `uvAtlas`), `uvAtlasStretch` (0 to 1; 0.1), patches' `initialPatches` (1–99999999, 250), `curvatureAlignment` (0.01–100, 1), `mergingThreshold` (1+, 1.5), `maxAngleDeviation` (0–180°, 45); views: `captureResolution` (pixels, 0–16384, 0 the atlas side, 2048), `captureFieldOfView` (degrees, 5–160, 30), `nearPlane` (metres, 0.00001–10, 0.01), `multiSampling` (0–8, 0), `captureAnisotropy` (1–16, 8); `maps` beside the base colour: `normal` (true), `roughness`, `metallic`, `specular`, `emissive` (false each); unbaked: roughness 0.5, metallic 0; roughness, metallic, specular share one image (G, B, R); `baseCapping` (`none`; `convexPolygon`: convex hull of vertices within `baseHeight` above the scene's lowest point, flat, facing down; `convexSolid`: that hull extruded up by `baseThickness`; `true`/`false` are `none`; default `none`), `baseHeight` (metres, 0 or more, 0 twice `accuracy`), `baseThickness` (metres, 0 or more, 0 the thickening's thickness when `autoThicken`, else 1.25 voxels); `groundClipping` (`none`; `discard`: triangles wholly on or under the plane dropped; `cut`: shell cut along the plane, what lies under removed; `cutAndFill`: cut and each loop filled flat; `true`/`false` are `none`; default `none`), `groundHeight` (world up coordinate, metres, 0); `useRenderLODMeshes` (source mesh read as its vertex buffers hold it, not welded by position; false) |
| `layers[].lodSelection`, `lodScreenSize` | `merge` layer's LOD per source : `calculate` (LOD shown when the source's sphere spans `lodScreenSize` of the view, above 0, 1 at most; 0.25) or `lowest` (fallback mesh); default `calculate` |
| `layers[].collapseEquivalentMaterials` | `merge` collapses equivalent materials into the first named; default `true` |
| `layers[].mergeMaterials` | `merge` merges the sources' materials into one atlas, one cell per material; default `false` |
| `layers[].bakeVertexColors` | `merge` keeping its materials keeps the sources' vertex colours (white where none); default `false`. Refused beside `mergeMaterials` |
| `layers[].simplification` | `simplify` steps, defaults when left out, lengths in metres: `voxel` (at least 0.001; none derives it from screen size), `gapWidth` (0), `unresolvedColor` (sRGB bytes, `[0, 0, 0]`), `transferDistance` (none: six voxels), `hardAngle` (degrees 0–180, `true` 130, `false`), `normalMethod` (`angleWeighted`, `areaWeighted`, `equalWeighted`), `gapSteps` (0–64, 7), `transferRays` (`nearest`, `facing`), `separateFoldedWalls` (false), `serialSimplify` (false): [Simplified layers](simplified-layers.md#simplified-layers) |
| `layers[].textureSizing` | Atlas sizing for `approximate`, atlas-merging `merge` and `simplify` layers: `fixed` (`textureSize`), `texelDensity` (power of two whose texels a metre over the mesh come nearest `texelsPerMetre`, 0.1–1024, 5), `screenSize` (power of two whose bounding sphere fills `atlasScreenSize` of a 1920-texel view, 0.01–1, 0.5), `drawDistance` (where the actor is first drawn); all layers also `biased` (normal map at `textureSize`, base colour at half, 32 at least, 8 for `merge`, whose tangent map is also half; other maps at a quarter, 16 at least, 4 for `merge`) and `manual` (each map at its `mapSizes` side, 16–8192 rounded up to a power of two, 1024: `base`, `normal`, `roughness`, `metallic`, `specular`, `emissive` for `approximate`; plus `opacity`, `opacityMask` for `simplify`; plus `tangent`, `anisotropy`, `ambientOcclusion` for `merge`; a packed image takes the largest side of its maps). Default `fixed` |
| `layers[].atlasGutter`, `binByTextureSize` | `merge` atlas: gutter texels per cell, up to 64, default 2; squares sized by their materials' largest textures instead of a grid, default `false`. `simplify` `atlasGutter`: texels between two charts, default 4 |
| `layers[].bakeOnMesh`, `allowDoubleSided`, `maps` | `merge` bake: a material whose look its mesh decides (coordinates leaving the unit square, vertex colour, second-set map) is baked on that mesh rather than a quad, default `true`; both faces drawn when a material does, default `true`; `maps` beside the base colour: `normal` (true), `roughness`, `metallic`, `specular` (packed metal-roughness red), `emissive`, `opacity` or `opacityMask` (at most one: base alpha, blended or masked at 0.3333), `ambientOcclusion`, `anisotropy` and `tangent` (one image, `KHR_materials_anisotropy`'s texture: direction in red and green, strength in blue; not drawn yet), each false unless named. `simplify` takes `allowDoubleSided` and `maps` too, the first seven maps (`normal` to `opacityMask`) |
| `layers[].reuseLightmapUVs`, `uvMethod` | `merge` coordinates for a mesh baked on its own triangles. `reuseLightmapUVs` `true` (default) with a texture set at the mesh's lightmap index: baked at that set, merged coordinates are its; else, or `false`, at coordinates generated by `uvMethod`: `default` or `patchBuilder` (patches unwrap), `xAtlas` (charts unwrap), `legacy` (chart layout of the first texture set, packed into a square a quarter of the atlas side wide (32 to 512 texels) then scaled to the unit square; a mesh with no first set, or whose charts have no area or outnumber the square's texels, takes the patches unwrap) or `uvAtlas` (spectral charts, stretch bound 0.11, 512 texels, 2.5-texel gutter; a mesh the cut fails on keeps its first texture set). `reuseLightmapUVs: false` lays meshes out together: every entry is baked on its mesh whatever `bakeOnMesh` says, at coordinates generated once for all entries as one mesh, into one atlas: no cell, gutter or binning (`atlasGutter`, `binByTextureSize` change nothing). If the whole unwrap fails each mesh is laid out alone, still in the one atlas. `simplify` reads `reuseLightmapUVs` too (default `true`): an object whose primitives all have a set at the lightmap index bakes on those sets, else on generated coordinates |
| `layers[].groupIdenticalMeshes`, `allowVertexColors` | `simplify` proxy settings. `groupIdenticalMeshes` (`false`): objects placing one mesh are baked once from the first; materials reading world position or per-instance data look as the first object's. `allowVertexColors` (`false`): the simplified mesh carries the sources' vertex colours (white where none); the atlas already holds them |
| `layers[].clusterDag` | Each actor an `approximate`, `merge` or `simplify` layer builds gets a cluster DAG (coarser levels within the pixel error); `false` (default): mesh drawn whole at every distance |
| `layers[].allowDistanceField` | Each actor mesh an `approximate`, `merge` or `simplify` layer builds gets a signed distance field, from the actor's triangles in world space (cell's sections together, blended section left out), written beside the source meshes' in `distanceFields.bin`. Default `true` (`approximate`), `false` (`merge`, `simplify`); `instanced`, `voxel` refuse it. Built at the job's `meshBuild` settings (`distanceField`, `distanceFieldTwoSided`, `distanceFieldDensity`, `distanceFieldMaxResolution`): `distanceField: false` there builds none for any layer; scale is always 1 (`distanceFieldScale` is a source mesh's own). Its memory counts in the layer job's working set |
| `layers[].disallowClusterDag` | `instanced` objects without their cluster DAG: `false` (default) each keeps its DAG; `true` stands each on its mesh's fallback (last LOD, once per mesh, drawn whole) |
| `layers[].meshBuild` | How a `merge` or `simplify` layer builds each actor's mesh: `keptTriangles`, `trimmedError`, `dropNearCollapsed`, `alwaysResidentKib` as [`meshBuild`](../how-a-mesh-coarsens.md#mesh-build-settings) names them, `shapePreservation` (`none` or `area`), `edgeLengthBound`, `holdTextureCoordinates` as a mesh's `extras` ([How a mesh coarsens](../how-a-mesh-coarsens.md#how-a-mesh-coarsens)); each default when left out. A `voxel` layer's names only the six `voxel…` settings of [`meshBuild`](../voxels-far-away.md#how-voxels-are-sampled) |
| `layers[].translucency` | How an `approximate`, atlas-merging `merge` or `simplify` layer bakes a translucent source (transmitting or alpha-blended): `seenThrough`: composed over what lies behind ([Translucent sources](translucent-sources.md#translucent-sources)); `surfaceOnly`; `true` is `seenThrough`, `false` `surfaceOnly`; default `seenThrough` |
| `layers[].emptyTexels` | Atlas texels with no chart value (outside every chart, gutter copies of texels no view sees) of an `approximate` or `simplify` layer: `nearestChart`, the nearest chart's values on every map, normal included; `black` (frame's up on the normal map, zero on baked roughness or metallic); `true` is `nearestChart`, `false` `black`; default `nearestChart` |
| `layers[].sizeFilter`, `minExtent`, `minArea`, `minVolume` | Objects an `instanced` layer takes by world box: `none`, `extent` (largest half extent, m), `area` (m²), `volume` (m³), each at least its setting (default 0); a turned-away object enters no HLOD, an [instanced skinned object](../the-partitions-grids.md#animation-banks) never is; default `none` |
| `assign[].match` | `node`, `mesh`, `material` (one of the mesh's), each an exact name or regular expression, and `extras`, values the node's `extras` holds; every field named must match, at least one |
| `assign[].layer` | Layer whose actors are the object's HLOD 0; the first matching rule wins |
| `default` | Layer of an object no mark nor rule names; none by default: no HLOD |

The merge and instanced settings above, on three layers of one job:

```ts
hlod: {
  layers: [
    // Objects drawn on the fallback of their meshes, never through their cluster DAG.
    { name: 'props', builder: 'instanced', disallowClusterDag: true },
    // Materials merged: more maps beside the base colour, each at its own side, a mesh baked on
    // its own triangles laid at generated charts where it has no lightmap texture set.
    {
      name: 'blocks',
      builder: 'merge',
      mergeMaterials: true,
      textureSizing: 'manual',
      mapSizes: { base: 2048, normal: 2048, roughness: 512, metallic: 512, ambientOcclusion: 512 },
      maps: { roughness: true, metallic: true, specular: true, ambientOcclusion: true, opacityMask: true },
      reuseLightmapUVs: false,
      uvMethod: 'xAtlas',
    },
    // Materials kept: the merged mesh keeps its sources' vertex colours.
    { name: 'tinted', builder: 'merge', bakeVertexColors: true },
  ],
  default: 'blocks',
}
```
