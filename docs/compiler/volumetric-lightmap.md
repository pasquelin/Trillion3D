# Volumetric lightmap

A job naming `lightmapBake` (`true`, or an object of the settings below; `false`/none, default:
nothing baked, cache key kept) gets scene indirect light baked on CPU into `volumetric-lightmap.bin`
([FORMAT.md](../format/volumetric-lightmapbin.md#volumetric-lightmapbin)), named by the manifest's
`volumetricLightmap` section (`volumetric_lightmap/bake/`). Deterministic, any thread count.

1. **Volume.** Boxes from `volumes`, or scene box grown by `automaticVolumeExpand` (cut to a cube of
   half-size `automaticVolumeLimit` around its centre if larger). Cut in top-level cells of
   `4^maxRefinementLevels` cells of `detailCellSize`.
2. **Bricks.** Triangles of objects meeting a box (opaque and masked) rasterised conservatively on a
   grid 4× finer than a finest brick; each fragment allocates cells within a quarter cell of it that
   lie within two cells of a box. A 4 × 4 × 4-probe brick per allocated cell, per coarser level
   (4× coarser each), and per coarsest-level cell.
3. **Probes.** `giSamples × qualityMultiplier` passes (preceded by `irradianceCacheQuality` while
   `irradianceCaching` is on). Per pass, per probe: one path in each hemisphere (up to 32 bounces,
   a light drawn and shadowed at each surface), added to the probe's spherical harmonics.
   - Sun shadowing = share of the first 32 passes whose ray reaches the sky.
   - With `skyLight`, the sky is the last light. The up-facing probe also gathers the sky's bent
     normal at its first bounce: sum of unshadowed sky directions, each over π (length = sky
     visibility, 1 open, 0 under a roof).
   - A path meeting a one-sided surface's back is no sample; a probe lit by under a third of passes
     is untrusted.
4. **Stitching.** Padding rows copied from the same-level neighbour; untrusted probes take the mean
   of trusted neighbours; a fine brick's border by a coarser brick takes its filtered light.
5. **Smoothing.** Ringing harmonics: each band scaled down by the window bringing the squared
   Laplacian of the light to the reciprocal of `sphericalHarmonicSmoothing`.
6. **Trimming**, before stitching. A finest brick the brick over it interpolates within
   `minBrickError` (RMS of ambient light) is dropped; then, if `loadingCellSize` is 0, finest bricks
   are dropped until `maximumBrickMemory` holds, greatest mean geometry distance first.
7. **Cells.** `loadingCellSize` above 0 (default): coarser bricks always loaded; finest bricks are
   written per cell of a grid of that size (8 m at default), read within `volumetricLightmapLoadingRange`, bounded by
   `volumetricLightmapBrickMemory` ([SDK](../sdk/canvas-camera-and-teardown.md)). With one brick
   level, volume stays one piece.

| Setting | Meaning | Default |
| - | - | - |
| `detailCellSize` | 0.01 to 200: finest-level cell size, metres | `2` |
| `qualityMultiplier` | Whole 1 to 256: multiple of `giSamples` per probe | `4` |
| `giSamples` | Whole 32 to 65536: paths per probe per quality unit | `512` |
| `maxRefinementLevels` | Whole 1 to 4: brick levels | `3` |
| `irradianceCaching` | Paths end in a cache of radiance after a first bounce; `false` for exteriors | `true` |
| `irradianceCacheQuality` | Whole 4 to 65536: cache-building passes | `128` |
| `irradianceCacheSpacing` | 0.04 to 10.24: cache cell size, metres | `0.32` |
| `irradianceCacheCornerRejection` | 0 to 8: how near a hit may be, in cache cells, for the cache to be read | `1` |
| `automaticVolumeExpand` | At least 0: metres the scene box grows without `volumes` | `5` |
| `automaticVolumeLimit` | Above 0: half-size, metres, where that box is cut to a cube | `100` |
| `maximumBrickMemory` | 1 to 65536: MB for finest bricks when volume is one piece | `30` |
| `sphericalHarmonicSmoothing` | 0 to 1000: smoothing where harmonics ring, 0 none | `0.02` |
| `loadingCellSize` | 0 to 100000: metres, cell of the grid finest bricks stream by; 0 = one piece | `32` |
| `minBrickError` | 0 to 1000: error under which a finest brick is dropped | `0.01` |
| `skyLight` | `true`, or object: `intensity` (any number, 1), `color` (3 linear, white), `lowerHemisphereColor` (3, black), `castShadows` (`true`); flat stationary sky | none: no sky |
| `volumes` | List of boxes, each lower then upper corner, metres | none: scene's own |

```json
{
  "lightmapBake": {
    "detailCellSize": 1,
    "giSamples": 256,
    "irradianceCaching": false,
    "skyLight": {
      "intensity": 1.5,
      "color": [0.7, 0.8, 1.0],
      "lowerHemisphereColor": [0.1, 0.1, 0.1],
      "castShadows": true
    },
    "volumes": [
      [
        [-40, -2, -40],
        [40, 30, 40]
      ]
    ]
  }
}
```

Sky radiance = cube (1 over the horizon, scene +y; 0.1 under it) × colour × intensity, at least 0;
all-zero adds no layer. `castShadows: true` adds the bent normal layer; `castShadows: false` lights
bounces but fills none. Command line: `--lightmap-bake={"giSamples":256}`, `--lightmap-bake=true`;
`--lightmap-bake='{"skyLight":true}'` shines the default sky: white, intensity 1, black lower
hemisphere.

```ts
await compile({
  source: 'city.glb',
  cache: 'cache/city',
  resourceBaseUrl: '/assets/city/',
  lightmapBake: { skyLight: { intensity: 1.5, color: [0.7, 0.8, 1] } },
})
```

A wrong kind or out-of-range setting refuses the job (`INVALID_OPTIONS`).

Not done:

- Captured sky: only flat `skyLight`.
- Reference's offline brick refinement; its `volumetricLightmapMaximumBrickMemoryMb` and
  `volumetricLightmapSphericalHarmonicSmoothing`.
- Lights are stationary. Point/spot = sphere of `emitterRadius` (point if none; `emitterLength`
  unread), sun = disk of `angularRadius`.
- Blended material, or masked with base-colour factor under its cutoff, passes all bake rays
  (texture alpha unread); colour and emission = factors × mean of textures.
- Deviation: under the irradiance cache bake counts a cell's surface emission once, reference twice
  (closed room, albedo 0.5, walls emitting 1: ambient 7.09 (`4π · 0.282 · 2`); bake 7.06 to 7.13; reference 10.6).
