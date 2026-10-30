# Volumetric lightmap

A job that names `lightmapBake` (`true`, or an object of the settings below; `false` or none, the
default, bakes nothing and keeps the cache key) gets the indirect light of its scene baked on the
CPU, in `volumetric-lightmap.bin` ([FORMAT.md](../format/volumetric-lightmapbin.md#volumetric-lightmapbin)), which the manifest's
`volumetricLightmap` section names (`volumetric_lightmap/bake/`). The bake follows the reference's GPU
lightmapper step for step, and a baked scene is the same at every run, whatever the threads: every
random number comes from a sequence seeded by the probe's place.

1. **The volume.** The boxes `volumes` names, or the scene's box grown by `automaticVolumeExpand`
   (cut to a cube of half-size `automaticVolumeLimit` around its centre when it is larger). It is cut
   in top-level cells of `4^maxRefinementLevels` cells of `detailCellSize`.
2. **The bricks.** The triangles of the objects that meet a box, those of opaque and masked materials,
   are rasterised conservatively on a grid four times finer than a finest brick; each fragment
   allocates the cells within a quarter cell of it that lie within two cells of a box. A brick of
   4 × 4 × 4 probes is made for each allocated cell, for each coarser level a cell has one below it
   (each level four times coarser than the last), and for every cell of the coarsest level, so that no
   part of the volume is left without light. Bricks are ranked coarse level first, then by Morton code.
3. **The probes.** `giSamples × qualityMultiplier` passes (and `irradianceCacheQuality` before them
   while `irradianceCaching` is on). Each pass takes, for every probe, one path in each of the two
   hemispheres around it — jittered inside the probe's cell, up to 32 bounces, a light drawn and
   shadowed at each surface and weighed against the light the bounce's own ray finds, Russian roulette
   by the light a path still carries — and adds the light to the probe's spherical harmonics. The sun's
   shadowing is the share of the first 32 passes whose ray toward it reaches the sky. Where the job
   names a sky light (`skyLight`), the sky is the last of the lights, drawn and met by the rays like
   the others, and the probe facing up also gathers the sky's bent normal at its first bounce: the sum
   of the directions toward the sky that the scene does not shadow, each over π — the mean direction
   the sky is seen from, whose length is the sky's visibility (1 under an open sky, 0 under a roof) —
   the sky drawn and the probe's own ray weighed against each other. A path that meets the back of a
   surface drawn on one side only is no sample; a probe lit by fewer than a third of the passes is
   not trusted.
4. **The stitching.** Padding rows are copied from the neighbouring brick of the same level; untrusted
   probes take the mean of the trusted ones around them; the border where a fine brick meets a coarser
   one takes the coarse brick's light, filtered, once for each level to cross.
5. **The smoothing.** Where a probe's spherical harmonics ring (highly directional light leaves black
   areas on the side opposite), each band is scaled down by the window that brings the squared
   Laplacian of the light to the reciprocal of `sphericalHarmonicSmoothing`; light that does not ring
   is left as it is.
6. **The trimming**, before the stitching. A finest brick the brick over it interpolates within
   `minBrickError` (the root mean square of the ambient light) is dropped; then, where the volume is
   one piece (`loadingCellSize` 0), as many finest bricks as the memory `maximumBrickMemory` asks to
   be dropped are, the ones whose mean distance to the geometry is greatest first. A dropped brick's
   place is read from the coarser brick over it.
7. **The cells.** With `loadingCellSize` above 0 (the default) the file's layers hold the coarser
   bricks, always loaded, and the finest bricks are written by cell of a grid of that size (rounded to
   a whole number of finest bricks, 8 m with the default cell), read by the runtime as the view comes
   within the loading range (`volumetricLightmapLoadingRange`) and bounded by its memory setting
   (`volumetricLightmapBrickMemory`, [SDK](../sdk/canvas-camera-and-teardown.md)). With a single level of
   bricks there is nothing coarser to always load, and the volume stays one piece.

| Setting                          | Meaning                                                                                                                                                                                                                                                                             | Default                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `detailCellSize`                 | A number from 0.01 to 200: the size, in metres, of a cell of the finest level; halving it can multiply the memory by up to eight                                                                                                                                                    | `2` (the reference's 200 cm)             |
| `qualityMultiplier`              | A whole number from 1 to 256: the multiple of `giSamples` the probes take                                                                                                                                                                                                           | `4`                                      |
| `giSamples`                      | A whole number from 32 to 65536: the paths a probe takes for a unit of quality, across all bounces                                                                                                                                                                                  | `512`                                    |
| `maxRefinementLevels`            | A whole number from 1 to 4: the levels of bricks (the file names a brick's span in a byte)                                                                                                                                                                                          | `3`                                      |
| `irradianceCaching`              | `true`: paths end in a cache of the radiance that leaves a surface after a first bounce; it brightens interiors and biases a little. `false` for an exterior scene                                                                                                                  | `true`                                   |
| `irradianceCacheQuality`         | A whole number from 4 to 65536: the passes that build the cache                                                                                                                                                                                                                     | `128`                                    |
| `irradianceCacheSpacing`         | A number from 0.04 to 10.24: the size of a cache cell, in metres                                                                                                                                                                                                                    | `0.32`                                   |
| `irradianceCacheCornerRejection` | A number from 0 to 8: how near a hit may be, in cache cells, for the cache to be read there                                                                                                                                                                                         | `1`                                      |
| `automaticVolumeExpand`          | A number of at least 0: how far, in metres, the scene's box grows when no volume is named                                                                                                                                                                                           | `5`                                      |
| `automaticVolumeLimit`           | A number above 0: the half-size, in metres, past which that box is cut to a cube                                                                                                                                                                                                    | `100`                                    |
| `maximumBrickMemory`             | A number from 1 to 65536: the megabytes the finest bricks may take where the volume is one piece (`loadingCellSize` 0)                                                                                                         | `30`                                     |
| `sphericalHarmonicSmoothing`     | A number from 0 to 1000 (0 to 1 in practice): how much the spherical harmonics are smoothed where they ring, 0 none                                                                                                             | `0.02`                                   |
| `loadingCellSize`                | A number from 0 to 100000: the size, in metres, of a cell of the grid the finest bricks stream by; 0 keeps the volume in one piece                                                                                              | `32` (the reference's 3200 cm)           |
| `minBrickError`                  | A number from 0 to 1000: the error under which a finest brick is dropped for the brick over it                                                                                                                                 | `0.01`                                   |
| `skyLight`                       | `true`, or an object of `intensity` (any number), `color` (three linear components), `lowerHemisphereColor` (three components) and `castShadows` (`true`): the stationary sky light the bake shines — a flat sky, as no captured sky reaches a compile job. `false` or none: no sky | none: no sky, no bent normal in the file |
| `volumes`                        | A list of boxes, each a lower then an upper corner in metres                                                                                                                                                                                                                        | none: the scene's own                    |

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

Here the lightmap covers a box of 80 × 32 × 80 m with cells of a metre, 256 paths a probe times the
default 4, and no irradiance cache (an open scene); the bake also shines a bluish sky of intensity
1.5: a cube that is one over the horizon (the scene's +y) and a tenth under it, times the colour and
the intensity. The sky lights the bounces in the spherical harmonics and, because it casts shadows,
the file gets its bent normal layer. On the command line,
`trillion3d-compile '--lightmap-bake={"giSamples":256}' …`, or `--lightmap-bake=true` for every
default; `--lightmap-bake='{"skyLight":true}'` shines the default sky: white, intensity 1, over a
black lower hemisphere. From Node:

```ts
await compile({
  source: 'city.glb',
  cache: 'cache/city',
  resourceBaseUrl: '/assets/city/',
  lightmapBake: { skyLight: { intensity: 1.5, color: [0.7, 0.8, 1] } },
})
```

The sky's radiance — the cube times the colour times the intensity — is held at 0 or more. A sky
whose radiance is zero everywhere shines nothing and adds no layer. A sky of `castShadows: false`
lights the bounces but fills no bent normal: the layer is written only where the sky is shadowed, as
the stationary sky light of the reference's lightmapper writes it. A setting of the wrong kind or out
of its range refuses the job (`INVALID_OPTIONS`).

What the bake does not do, said rather than guessed:

- **The captured sky.** The compile job holds no captured sky, so the sky is a flat one that the job
  names (`skyLight`): a cube of one over the horizon and `lowerHemisphereColor` under it. Without
  `skyLight` the sky gives no light and the file has no bent normal layer; an outdoor scene's
  lightmap then holds the light of its lights and emissive surfaces alone. The sky is a stationary
  light like the others: the engine draws its direct light itself, the lightmap holds what it gives
  after a bounce and its bent normal.
- **The reference's offline lightmapper.** Its brick refinement by lights and by the lighting's error
  (the cell expansions for geometry and lights, the light brightness that subdivides, the least brick
  error) belongs to its offline solver, which the GPU lightmapper this bake follows does not run: the
  GPU lightmapper allocates the bricks around geometry alone, as `bricks` above says, so these have no
  setting here.
- **Lights.** Every light is a stationary one: the engine draws its direct light itself, the lightmap
  holds what the light gives after a bounce. A point or spot is a sphere of its `emitterRadius` (a
  point when it names none; a tube's `emitterLength` is not read), the sun a disk of its
  `angularRadius`.
- **Surfaces.** A blended material, or a masked one whose base-colour factor is under its cutoff, lets
  everything through the bake's rays (the texture's alpha is not read), and a surface's colour and
  emission are its factors times the mean of their textures.
- **The reference's own limits** that the bake does not take: the memory cap and the spherical
  harmonics smoothing of the reference's offline importer (`volumetricLightmapMaximumBrickMemoryMb`,
  `volumetricLightmapSphericalHarmonicSmoothing`) are steps of that importer, which its GPU lightmapper
  does not run, so they have no setting here.
- **A deviation, proved.** Under the irradiance cache a path that ends in a cell takes the cell's
  radiance, which already holds the emission of its surface; the reference adds that emission once
  more, so an emissive surface lights twice as much beside a cache cell. The bake adds it once: in a
  closed room of albedo 0.5 whose walls emit 1, the ambient is 7.09 (`4π · 0.282 · 2`); the bake reads
  7.0 to 7.19 without the cache and 7.06 to 7.13 with it, where the reference's step reads 10.6 with it.
