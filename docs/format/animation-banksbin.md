# `animation-banks.bin`

The clips the scene's instanced skinned objects play on the GPU (`objectSettings`'
`skinnedInstance`, [COMPILER.md](../COMPILER.md)), each sampled once. A bake is one skin's clip at its
own rate in frames a second — the first of 30, 24, 23.976, 25, 29.97, 48, 50, 60, 59.94, 72, 90, 100,
120, 144, 165, 240 and 480 at which the clip's duration is a whole number of frames within a
millisecond, else 30 (`ANIMATION_BANK_SAMPLE_RATE`): each joint's transform in the skin's frame — the
node its top joints hang under — per frame, translation then rotation, and each joint's inverse
bind matrix; identical bakes are written once. An item is what objects play: a bake on a mesh,
whether its track loops, the second it starts from, its play rate, the screen size under which it
rests (0 the run-time setting's, negative never) and its sampled bounds — the mesh's box grown by
every joint's translation of every frame, scaled by its `boundsScale` about its centre —, in the
frame's space. Every instance of one item is in one pose: one track.

- Layout (little-endian, version 2): a 5-word header (magic `TBNK`, version, bake count, item
  count, pool length in floats); 5-word bakes (joints, frames, inverse binds' and keys' first
  float in the pool, the rate as `f32`); 12-word items (bake, flags — bit 0 looping —, position, play rate, minimum
  screen size as `f32`, six `f32` bounds, mesh rank); the `f32` pool: per bake its inverse binds
  (twelve floats a joint, the three rows of its affine part) and its keys (seven floats a joint a
  frame: translation, then the rotation quaternion `x y z w`).
- The manifest names it in `animationBanks` (`url`, `version`, `bytes`, `sha256`, `items`), absent
  for a scene with no item. A cell node's `track`, a core node's `bank`, is an item's rank.
- Versions: `ANIMATION_BANKS_VERSION` (`rust/compiler/tables/motion/bank.rs`,
  `core/contracts/writtenFormats.ts`).
- Writes `rust/compiler/tables/motion/bank.rs:bake_banks`; reads
  `core/scene/core/animationBanks.ts:decodeAnimationBanks`.
