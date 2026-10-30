# Animation banks

An instanced skinned object ([COMPILER.md](../compiler/the-partitions-grids.md#object-settings)) plays a track of its
scene's animation banks ([FORMAT.md](../format/animation-banksbin.md#animation-banksbin)): every instance of one item is
in one pose. A bake is sampled at its clip's own rate, which the file records, so the track is as long as the clip: its
frames less one over that rate. The track's clock runs on the CPU with the scene's clips — a frame draws the second
the track held when it began, then the track advances by the frame's seconds times its play rate
times `animationBankTimeScale`, wrapping when it loops, held at its ends otherwise
(`packages/sdk-core/src/world/animation/bankClock.ts`) —; the GPU evaluates it: one pass before the
deformation turns each joint's two nearest keys, blended, and its inverse bind into the track's
palette, this frame's and the last one's (`deformation/bankWgsl.ts`). Every instance of a track
reads the same deformed vertices, made once an image. An instance whose screen size — its
sampled bounds' diameter over the view's height — falls under its `animationMinScreenSize`, or
under the run-time setting where its own is 0, is drawn in its rest pose; one whose own is negative
always animates; one drawn as its cell's HLOD 0 actor takes the run-time setting. Its bounds, for
every cut and its cell, are its item's sampled bounds.

Every setting is the reference's by default, a world option by its field, held over the quality
preset, changed later from the next frame
(`packages/sdk-core/src/contracts/animationOptions.ts`); a value a setting does not take is
refused:

```ts
const world = createWorld(canvas, { animationMinScreenSize: 0.05 })
```

| Field                        | Meaning                                                                                   | Default |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------- |
| `animationMinScreenSize`     | The screen size under which an instanced skinned object is drawn in its rest pose, from 0 | `0.1`   |
| `animationBankInterpolation` | A track blends its two nearest keys; `false`, its pose is the earlier key's               | `true`  |
| `animationBankTimeScale`     | The scale of the world's seconds the tracks advance by                                    | `1`     |
