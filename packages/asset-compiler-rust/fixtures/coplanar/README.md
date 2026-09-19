# Correction fixtures — coplanar layers

Five minimal glTF scenes that pin the behaviour of the compiler's `coplanar-depth-layers-v1` stage.
Each folder contains the scene (`<name>.gltf` + `<name>.bin`) and the expected verdict
(`expected.json`), checked by hand by compiling the scene with the CLI.

Verification command, from the repository root:

```
cargo build --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml
./packages/asset-compiler-rust/target/release/web-geometry-compiler \
  packages/asset-compiler-rust/fixtures/coplanar/<name>/<name>.gltf <CACHE>/<name> full 1000000 /assets
jq '.coplanar' <CACHE>/<name>/native/full/<key>/clusters.json
```

`depthLayerPerPage` is read in column 20 of `clusters.bin` (one `u32` per cluster, in the order
of primitives then pages), or in the `depthLayer` field of each page before the manifest
cut.

In all five scenes, the two overlapping meshes do not have the same triangulation: each cell
is cut by a different diagonal from one mesh to the other. That is what makes the winner
undecidable by depth alone, and that is the reason the stage exists.
