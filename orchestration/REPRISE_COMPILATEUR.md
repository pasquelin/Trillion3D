# Compilateur — todo

`get_session("self")` first, then `AGENTS.md`. One Opus at a time, worktree from develop, merge `--no-ff` into develop locally, remove the batch worktree and branch, tell the Validateur, next item. No push, no `validate`, no tests or measurement campaigns unless the user orders them: code, `tsc --noEmit`, deliver, the user checks in his Lab. Go required before each item below.

1. Import lamps from USD (`UsdLux`: sphere, disk, rect, distant, with units) and Blender (`Lamp` of the SDNA), so `emitterRadius` can come from `inputs:radius` and `shadow_soft_size`.
2. Reuse a complete compiled product when every dependency hash and product already exists, instead of rebuilding the DAG.
3. Linear cut for convex n-gons in `ngon.rs` (quadratic today, 8 000 corners = 113 ms); concave faces keep the ear cut.
4. Decode each shared image once in `texture_preview.rs` (bounded cache by hash, one pyramid per MASK threshold).
5. Extract a unitypackage in one pass, keeping CRC, bounds, cancel and no partial publish.
6. Admission before import, and cancel points inside long n-gon cuts and normal computation.
7. Keep DDS/KTX2 blocks on the GPU without decoding.
8. Accept Draco and meshopt compressed glTF as input.
9. Industrial Map on bench 15.
10. FAB licence check for the corpus.

Every optimisation (2 to 6) must give the same bytes as before.
