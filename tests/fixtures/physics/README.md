# Physics fixtures

The files the native compiler's physics cook tests read (`packages/asset-compiler-rust/src/physics_cook/`).

- `ramp-tile.bin`, `small-ramp-tile.bin`: golden cooked tiles of a two-triangle ramp, written by
  the cook itself (`TRILLION3D_WRITE_GOLDEN=1`).
- `pawn-body-patch.bin`: 200 connected triangles of the `Pawn_Body_Shared` mesh (mesh 6) of
  _A Beautiful Game_ (`abeautiful-game`, `ABeautifulGame.gltf`), Khronos glTF Sample Assets,
  **CC-BY-4.0**: original model © 2020 ASWF (MaterialX Project), conversion to glTF © 2022 Ed
  Mackey. Reduced by taking the first triangle from index 20 000 whose doubled area is under
  Jolt's 1e-6 limit, then growing through shared vertices over such triangles only, reindexed:
  every triangle is one Jolt drops (#562). Positions are the model's, in metres, unchanged. Layout,
  little-endian: `u32` vertex count, then `f32` x, y, z per vertex, then `u32` indices, three per
  triangle.
