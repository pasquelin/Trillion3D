# Correction fixtures — `usd` driver

Two fixtures, two distinct questions. The golden is
[`../../../../packages/asset-compiler-rust/src/tests/formats/usd/golden.rs`](../../../../packages/asset-compiler-rust/src/tests/formats/usd/golden.rs); isolated behaviours are in
`packages/asset-compiler-rust/src/tests/formats/usd/driver.rs`, what is counted in the report in `packages/asset-compiler-rust/src/tests/formats/usd/report.rs`, hard rejections in
`packages/asset-compiler-rust/src/tests/formats/usd/refusal.rs`.

| file                         | what it pins                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `minuscule/scene.usda`       | what the driver produces: `Xform` hierarchy, `Mesh` of two quads, `GeomSubset` `materialBind`, two materials of which one is textured |
| `minuscule/textures/checker.png` | the texture the translucent material cites, resolved relative to the layer folder |
| `corpus/usda/scene.usda`     | the same scene as `corpus/usdc`, in text                                          |
| `corpus/usdc/scene.usdc`     | the same scene as `corpus/usda`, in binary “crate”                                |

What each choice puts under watch:

- **two quadrilaterals and a one-face subset**: fan triangulation, and the fact
  that a material part becomes a separate glTF primitive — faces that no subset
  claims falling back to the mesh binding;
- **a `constant` normal and a `vertex` `primvars:st`**: the two interpolations of a primvar
  do not resolve at the same rank of the array, and that rank is what deduplicates vertices;
- **an opaque `UsdPreviewSurface` and another with `opacity` 0.5 and a texture**: `baseColorFactor`,
  `alphaMode` and the texture slot, without any rule naming an object type;
- **the same scene in `usda` and in `usdc`**: both serialisations must yield the **same**
  intermediate scene, down to the node and the sidecar byte. That is the only proof that counts that the
  driver reads a document and not a writing. Three cubes, three materials, thirty-six triangles.

## Provenance and licences

- `corpus/`: WebGeometry corpus (`test/assets/usd/procedural-usda` and `procedural-usdc`),
  **CC0-1.0**, see [LICENSE.txt](LICENSE.txt). `test/assets/` is not tracked by git: these bytes
  are copied here so the golden holds without it.
- `minuscule/scene.usda`: written by hand for this test from the public AOUSD specification,
  with no third-party content. `minuscule/textures/checker.png` comes from the same CC0 corpus.

## `expected.json`

The selected driver, the intermediate scene it wrote — nodes, meshes, materials, images,
samplers, textures, accessors, report — and the compiled scene that comes out of it, sidecar included.
The cache key does not appear in it: a converted scene's manifest carries its import duration, so the
key changes from one run to the next without the scene moving. `case` and `rule` are prose only,
the test strips them before comparing. To regenerate it:

```sh
cargo test --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml --lib regenerate_the_usd_fixture -- --ignored
```
