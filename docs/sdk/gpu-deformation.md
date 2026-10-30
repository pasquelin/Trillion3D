# GPU deformation

Imported glTF and FBX clips are `model.animations`. `animation.createMixer(root)` binds clips to
names below `root` (a loaded model: its tracks and morph weights); `mixer.clipAction(clip)` has
`play()`, `stop()`, `seek(seconds)` (the pose now, playing or not, kept by a stopped action until a
playing one writes over it), `weight`, `timeScale` and `blendMode`;
`animation.weightsTrack(path, times, values)` holds all morph weights at each key;
`animation.skeleton(bones, inverseBindMatrices?)` without matrices uses the current bind pose.

FBX clips are evaluated by ufbx, keys and span kept, curves subdivided to a chord error of 2.5e-7
and Euler steps of 15 degrees at most, so whole turns survive. `IMPORT_UNSUPPORTED_ANIMATION`
refuses skins with unbound vertices or more than 65,536 joints, stepped or extrapolated curves,
intermediate shapes, layered or constrained animation, sheared world transforms, more than 36,000
distinct keys and times colliding at float32; a clip is never truncated. Skin weights stay exact
float32 source values.

```ts
const model = await world.scene.load('/character/cache/native/full/manifest.json')
const mixer = animation.createMixer(model)
const walk = mixer.clipAction(model.animations[0]).play()
walk.weight = 0.8
walk.timeScale = 1.2
// Stop at a repeatable pose, for inspection or a reference comparison.
walk.stop().seek(0.5)
world.invalidate()
```

A page-created mesh uses `mesh.skeleton = animation.skeleton(bones, inverseBindMatrices)` with
four-component `skinIndex` / `skinWeight` attributes; morph targets go in
`geometry.morphAttributes.position` (optionally `.normal`), then `mesh.updateMorphTargets()`;
`node.morphTargetInfluences` is animated by `animation.weightsTrack` or written. Each placement of a
shared geometry reads its own palette and weights.

Actions blend by `weight`; `action.blendMode = 'additive'` adds the difference from the clip's first
key. `animation.twoBoneIK(root, mid, end, target, pole?, weight?)` solves a bone chain after
sampling; `animation.windClip(bones, options?)` loops bones (`direction: [x, z]`, `angle` in
radians, `frequency` in Hz). `mesh.waves` shares the physics' waves with a water mesh
([PHYSICS.md](../PHYSICS.md)).

An instanced skinned object a compile named (`objectSettings.skinnedInstance`,
[COMPILER.md](../compiler/the-partitions-grids.md#object-settings)) plays its baked clip on the GPU by itself, from the
scene's load: no mixer moves it ([ENGINE.md](../engine/animation-banks.md#animation-banks)).

The GPU deforms vertices before culling and drawing
([ENGINE.md](../engine/gpu-deformation.md#gpu-deformation)). `metrics.gpuDeformationMs` is the
latest measured WebGPU deformation time, `null` without a timestamp sample.
