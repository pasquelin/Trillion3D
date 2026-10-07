# Physics fixtures

The files the native compiler's physics cook tests and the physics module's tests read. The cook's
goldens are written by the cook itself under `TRILLION3D_WRITE_GOLDEN=1`.

- `ramp-tile.bin`, `small-ramp-tile.bin`: golden cooked tiles of a two-triangle ramp.
- `height-field-tile.bin`: the golden cooked height field of a 5 × 5 grid 0.5 m apart, rising as
  x z (`tests.rs`); the physics module's tests restore it beside the ramp (`tileGround.test.ts`).
- `cloth-settings.bin`: the golden cooked soft body, a 1 m cloth of 2 × 2 squares pinned at its top
  corners, Jolt's `SoftBodySharedSettings` binary state (`soft_tests.rs`); the physics module's test
  restores it (`packages/sdk-browser/src/physics/cookedSoft.test.ts`).
- `cube-hull.bin`: the golden cooked hull of a unit cube, Jolt's `ConvexHullShape` binary state
  (`mass_tests.rs`).
- `soft-records.bin`: the cook's soft records of a cloth, a welded rope and a closed tetrahedron
  (`soft_tests.rs`); the page rebuilds each with `softBodyOf` and must match them bit for bit
  (`packages/sdk-core/src/physics/softCook.test.ts`).
- `pawn-body-patch.bin`: 200 connected triangles of the `Pawn_Body_Shared` mesh (mesh 6) of
  _A Beautiful Game_ (`abeautiful-game`, `ABeautifulGame.gltf`), Khronos glTF Sample Assets,
  **CC-BY-4.0**: original model © 2020 ASWF (MaterialX Project), conversion to glTF © 2022 Ed
  Mackey. Reduced by taking the first triangle from index 20 000 whose doubled area is under
  Jolt's 1e-6 limit, then growing through shared vertices over such triangles only, reindexed:
  every triangle is one Jolt drops. Positions are the model's, in metres, unchanged. Layout,
  little-endian: `u32` vertex count, then `f32` x, y, z per vertex, then `u32` indices, three per
  triangle.
- `soft-writeback-develop.bin`: the soft words a reference physics module (`cc7d590615`) wrote at
  the kept steps of `writebackScene` (`packages/sdk-browser/src/physics/softWriteback.fixture.ts`);
  `softWriteback.test.ts` holds the module to them within its bound and says how to record them
  again. Its scene keeps every body 20 m above the floor and every teleport under 3 m, past which a
  soft body starts again in its rest shape. Layout, little-endian `u32`: the step count, then per
  step its word count and its words (`softLayout.ts`).
