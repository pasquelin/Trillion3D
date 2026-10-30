# Animation banks

An instanced skinned object ([COMPILER.md](../compiler/the-partitions-grids.md#object-settings))
plays a track of its scene's animation banks
([FORMAT.md](../format/animation-banksbin.md#animation-banksbin)): all instances of one item share
one pose. A bake is sampled at its clip's own rate (recorded in the file), so track length = frames
less one over that rate.

Track clock runs on CPU with the scene's clips: a frame draws the second the track held when it
began, then the track advances by frame seconds × play rate × `animationBankTimeScale`, wrapping if
looping, else held at its ends (`packages/sdk-core/src/world/animation/bankClock.ts`). GPU evaluates
it: one pass before deformation turns each joint's two nearest keys, blended, and its inverse bind
into the track's palette, this frame's and last (`deformation/bankWgsl.ts`). All instances of a track
read the same deformed vertices, made once an image.

An instance whose screen size (sampled bounds' diameter over view height) is under its
`animationMinScreenSize`, or under the run-time setting where its own is 0, draws in rest pose; own
negative: always animates; drawn as its cell's HLOD 0 actor: takes the run-time setting. Its bounds,
for every cut and its cell, are its item's sampled bounds.

Every setting defaults to the reference's, is a world option by its field, held over the quality
preset, changed later from the next frame (`packages/sdk-core/src/contracts/animationOptions.ts`);
unaccepted values are refused:

```ts
const world = createWorld(canvas, { animationMinScreenSize: 0.05 })
```

| Field | Meaning | Default |
| - | - | - |
| `animationMinScreenSize` | Screen size under which an instanced skinned object draws in rest pose, from 0 | `0.1` |
| `animationBankInterpolation` | Track blends its two nearest keys; `false`: pose = earlier key's | `true` |
| `animationBankTimeScale` | Scale of world seconds the tracks advance by | `1` |
