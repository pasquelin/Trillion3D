# Correction fixture — progressive colour-texture previews

A tiny glTF scene that pins the compiler's `texturePreviews` section end to end:
real glTF → `compile()` → cache → `texturePreview*` columns of `clusters.bin`. The in-memory
unit tests of `../../src/texture_preview/tests/` pin the math on images built in
memory; this one pins the bytes an engine will actually read, PNG decoder and JPEG decoder
included.

## `atlas-couleur`

Four two-triangle quads, spaced three units apart so no pair is coplanar —
the scene speaks only of textures.

| primitive | material | class | colour texture |
| --- | --- | --- | --- |
| 0 | `beton` | opaque | `baseColorTexture` → texture 0 |
| 1 | `grille` | `MASK`, `alphaCutoff` **0.25** | `baseColorTexture` → texture 1 |
| 2 | `vitre` | `BLEND` | `baseColorTexture` → texture 2 |
| 3 | `lampe` | opaque, emissive | `emissiveTexture` → **texture 2**, shared with `vitre` |

| image | file | provenance | dimensions | first carried level | levels |
| --- | --- | --- | --- | --- | --- |
| 0 | `base-degrade.png` | `uri` | 40 × 24 | 0 | 6 |
| 1 | — | `bufferView` 6 of `atlas-couleur.bin` | 24 × 16 | 0 | 5 |
| 2 | `lueur.jpg` | `uri` | 80 × 48 | **1** | 6 |

What each choice puts under watch:

- **40 × 24** is neither square nor a multiple of sixteen: the box-average cells do not all
  have the same size and the last level is reached by truncation.
- **80 × 48** is the only image whose one side exceeds `PREVIEW_BASE`: its first carried level is
  mip 1, never mip 0. It is also the only JPEG, hence the second decoder.
- **24 × 16 with strictly binary alpha** (a centred ellipse, coverage of exactly 192 texels
  out of 384) is the only texture whose every binding is a `MASK` base colour: it is
  the only one whose alpha is rescaled to preserve that coverage. The other two
  keep their alpha intact, which `coveredAtMaskCutoff` of `expected.json` shows by remaining equal
  to the total texel count of each level.
- **Texture 2 is shared** between a `BLEND` and an emissive: none of its bindings is a
  `MASK`, so no cutoff applies.
- **One image by `uri`, one by `bufferView`**: both source-byte read paths.

## `expected.json`

For each sidecar entry: the ten numbers it declares, the digest of its source image,
then each level with its dimensions, the **sha256 of all its bytes**, five texels (four corners
and centre) and its coverage at the `MASK` material cutoff. The sha256 trips the golden as soon as a
preview byte changes; the texels and the coverage say *where* the computation moved. `case` and `rule`
are prose only, the test strips them before comparing.

## Regenerating

The scene, its images and its expected all come from the same code, `../../src/tests/apercus_source.rs`:

```
cargo test --release --manifest-path packages/asset-compiler-rust/Cargo.toml \
  -- --ignored regenere_la_fixture_des_apercus --nocapture
npx prettier --write packages/asset-compiler-rust/fixtures/apercus/atlas-couleur/expected.json
```

The test that writes it is ignored by default. **The diff it produces is re-read before being committed**:
a regenerated expected without a reading no longer watches anything. The bytes of a decoded JPEG depend on the
decoder: a version change of the `image` crate requires regenerating, and justifying
the gap in the commit message.
