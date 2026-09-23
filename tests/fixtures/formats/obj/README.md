# Correction fixture — `obj` driver (OBJ and its `.mtl` library)

One fixture, one question: **what an OBJ and its `.mtl` yield, and what the driver counts without
rendering it**. The golden is [`../../../../packages/asset-compiler-rust/src/tests/formats/obj_golden.rs`](../../../../packages/asset-compiler-rust/src/tests/formats/obj_golden.rs); what
requires modifying the source between two compilations — library touched, missing, truncated, texture
name to escape — is in [`../../../../packages/asset-compiler-rust/src/tests/formats/obj_mtl.rs`](../../../../packages/asset-compiler-rust/src/tests/formats/obj_mtl.rs).

| file                       | what it pins                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `minuscule/scene.obj`      | two groups, a quadrilateral and a pentagon, shaded by two `usemtl`                                                                                                                   |
| `minuscule/scene.mtl`      | everything a library declares: `Ka`, `Kd`, `Ks`, `Ns`, `Ni`, `d`, `Ke`, `map_Ka`, `map_Kd`, `map_d`, `norm`, `map_Bump`, `map_Ke`, and the `-s`, `-o`, `-bm`, `-clamp` options      |
| `minuscule/textures/*.png` | six 2×2 images: three enter the output, three prove a report code                                                                                                                    |

What each choice puts under watch:

- **a pentagon**: triangulation, three triangles for one face, five in all with the quad;
- **`d 0.5` and `map_d` on a different file from `map_Kd`**: the material comes out as `BLEND`, never as
  `MASK` — a cut-out transparent would be a loss —, and the separate map that glTF cannot
  carry is counted under `material-separate-opacity-texture` instead of being swallowed;
- **`norm` and `map_Bump` pointing at two different files**: the **normal wins**, and the bump
  left behind is counted under `material-bump-map`. Without that, the reader's “last one wins”
  changed the normal map without anything saying so;
- **`Ks`, `Ni`, `Ka` and `map_Ka`**: glTF's metal-roughness model has no place for any of the
  three. They are counted — `material-specular-color`, `material-specular-ior`,
  `material-ambient-color` — and **never guessed**: a specular colour does not become metal,
  those are two models;
- **`-clamp on` on `map_Ke`**: the only map option glTF carries as-is, become the sampler
  wrap mode (`wrapS` and `wrapT` at `CLAMP_TO_EDGE`);
- **`-s`, `-o` on `map_Kd` and `-bm` on `norm`**: accepted by the reader then inert.
  The glTF writer does not know `KHR_texture_transform` and nothing carries bump strength:
  they are counted under `texture-scale`, `texture-offset` and `texture-bump-scale`;
- **`Ns 60`**: the specular exponent, which does become a roughness and is therefore not counted.

## Provenance and licences

- `minuscule/scene.obj` and `minuscule/scene.mtl`: written by hand for this test from the
  published specification of the OBJ format and its material library, with no content, code or SDK
  from a third party.
- `minuscule/textures/*.png`: six 2×2 RGBA images written for this test by a minimal PNG encoder.
- Everything is **CC0-1.0**, see [LICENSE.txt](LICENSE.txt).

## `expected.json`

The selected driver, the intermediate scene it wrote — nodes, meshes, materials, images,
samplers, textures, accessors, report, and the external files the read opened
with their fingerprint — then the compiled scene that comes out of it, sidecar included. Neither the cache key nor the
durations appear in it: a golden pins a scene, never a clock. `case` and `rule` are
prose only, the test strips them before comparing. To regenerate it:

```sh
cargo test --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml --lib regenerate_the_obj_fixture -- --ignored
```
