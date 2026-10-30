# Distance fields and chart examples

A merged chain whose coarse levels shade the far band: a merged shell has no distance field by
default, and asks for one with `allowDistanceField` (an approximated shell has one by default;
`false` leaves it out). The density and the most voxels along an axis are those of the scene's
meshes, the HLOD cells' included:

```js
await compile({
  source: 'district.glb',
  cache: 'cache/district',
  resourceBaseUrl: '/assets/district/',
  hlod: {
    layers: [
      { name: 'hlod0', builder: 'instanced', parent: 'hlod1' },
      {
        name: 'hlod1',
        builder: 'merge',
        parent: 'hlod2',
        lodSelection: 'lowest',
        allowDistanceField: true,
      },
      {
        name: 'hlod2',
        builder: 'merge',
        parent: 'hlod3',
        lodSelection: 'lowest',
        allowDistanceField: true,
      },
      { name: 'hlod3', builder: 'approximate', spatiallyLoaded: false },
    ],
    default: 'hlod0',
  },
  meshBuild: { distanceFieldDensity: 0.2, distanceFieldMaxResolution: 256 },
})
```

The world report (`worldRoots` in the compile result) gains `actorFields`, the number of HLOD cells
that got a field; the cook's step timings (`metrics.hlodStepMs`) gain `distanceField`.

The old chart layout on a `merge` layer, the spectral charts on an `approximate` one:

```ts
hlod: {
  layers: [
    // Each cell's meshes merged into one atlas, a mesh baked on its own triangles laid out by the
    // old chart layout of its first texture set.
    {
      name: 'blocks',
      builder: 'merge',
      mergeMaterials: true,
      reuseLightmapUVs: false,
      uvMethod: 'legacy',
      parent: 'far',
    },
    // The far shells unwrapped by spectral charts at a looser stretch bound.
    {
      name: 'far',
      builder: 'approximate',
      spatiallyLoaded: false,
      approximation: { uvMethod: 'uvAtlas', uvAtlasStretch: 0.2 },
    },
  ],
  default: 'blocks',
}
```

A job that names no `uvMethod` and keeps `reuseLightmapUVs` on keeps its cache key and its bytes. A
job with `reuseLightmapUVs: false` has new bytes (the entries are laid out together now): recompile
it.
