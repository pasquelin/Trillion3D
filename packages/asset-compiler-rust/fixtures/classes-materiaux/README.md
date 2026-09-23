# Measurement scenes — material classes

No bench scene carries the classes the engine distinguishes: Emerald has only blended
foliage, neither cutout nor a transmissive surface. These two minimal glTF scenes carry them, each
subdivided enough to yield several clusters and therefore a real DAG cut. No texture: the
class is read from the material alone, and each scene stays two readable files.

## `classes-materiaux` — opaque, cutout, blend

| mesh         | material                                         | class  | compiler packing  |
| ------------ | ------------------------------------------------ | ------ | ----------------- |
| `opaque0..2` | `beton`                                          | opaque | `exact-clusters`  |
| `grille`     | `grillage`, `alphaMode: MASK`, `alphaCutoff 0.5` | cutout | `exact-clusters`  |
| `vitre`      | `vitre`, `alphaMode: BLEND`                      | blend  | `clustered-blend` |

4,516 triangles. This is the scene the harness measures.

## `transmission` — the fourth class, and something to see it with

| mesh       | material                                                                                                                                     | class        | compiler packing |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------- |
| `fond`     | `fond`, opaque                                                                                                                               | opaque       | `exact-clusters` |
| `bloc0..2` | `beton`, opaque                                                                                                                              | opaque       | `exact-clusters` |
| `eau`      | `eau`, `KHR_materials_transmission` 1.0, `KHR_materials_ior` 1.33, `KHR_materials_volume` (thickness 2.5, distance 6, colour 0.35/0.72/0.68) | transmission | `shared-blend`   |

2,880 triangles. A water plane at `y = 0` above a ground at `y = -2.5` and three blocks, of which two
pierce the surface: what is looked at is the deviation of the ground under the water against the straight line of
the block above it, and the tint the attenuation distance gives it. A scene with nothing
behind the water would have proved nothing at all. Every triangle winds outward — the ground and
the water face `+y`, the blocks face away from their centre — so that a single-sided material
shows the faces the camera sees; the first form of the file wound them all inward and rendered
the blocks as their far faces.

The compiler packs the water as `shared-blend`: outside the DAG, one primitive = one whole mesh,
source order kept. That primitive therefore has no cluster, hence no error band, and
`assertCacheIdentity` accepts it on that ground since the water batch; a `shared-blend` primitive that
would still carry pages remains refused.

## `emetteur-sphere` — the emitter's spherical exclusion

| mesh                  | material                               | role                                                                                         |
| --------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `sol`                 | `sol`, opaque                          | receives the shadow                                                                          |
| `occultant-diagonale` | `occultant`, opaque                    | 0.3121 m from the lamp centre (0.19, 0.18, 0.17 relative) — outside the 0.20 m radius sphere |
| `occultant-proche`    | `occultant`, opaque                    | 0.15 m from the lamp centre — inside the sphere                                              |
| `enveloppe-lampe`     | `enveloppe`, non-zero `emissiveFactor` | the luminaire around the lamp: six vertices at 0.20 m from its centre                        |

34 triangles, one point lamp (`lampe`, `KHR_lights_punctual`, range 3 m). The glTF declares
no radius: `KHR_lights_punctual` carries none (`docs/SDK.md`). It is the compiler that writes
`"emitterRadius": 0.2` in `lights.json`, measured on `enveloppe-lampe` — the lamp's emissive sibling,
an octahedron whose six vertices are 0.20 m from its centre — and counted under
`light-emitter-radius-derived`. Nothing is added by hand: `loadImportedLights`
(`packages/sdk-browser/importedLights.ts`) validates the value by the same contract as the host's
lamps. Reproduction of the VERIFICATION_STABILISATION_5896648_2026-09-16 audit (defect 4):
`occultant-diagonale` is outside the sphere but fell inside the cube the old near plane
excluded; `occultant-proche` falls in both, before as after, and crosses the envelope —
it is the wall that cuts the glass, and it occludes beyond it.

## Compile and measure

From the repository root:

```
cargo build --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml
./packages/asset-compiler-rust/target/release/web-geometry-compiler \
  packages/asset-compiler-rust/fixtures/classes-materiaux/<name>.gltf <CACHE> full 1000000 /assets

node bench/runner/banc.ts --moteur webgpu --avant <ref> --apres <ref> \
     --cache-avant <CACHE> --cache-apres <CACHE> --vues generale,detail \
     --images 60 --pixelError 0.1
```

`<CACHE>` is the “derived” folder: the one that receives `native/full/manifest.json`. It lives outside the
repository (`.mesure/` for example); nothing is written into the bench assets.
