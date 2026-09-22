# Original offline geometry recipes

These deterministic authoring examples produce glTF triangle assets, compiled by this
repository's native compiler and rendered through `createWorld` and `scene.load`. They are not
runtime geometry modifiers. No external engine code, model or font is used.

Regenerate with `node scripts/docs-geometry.mjs` after building the native compiler. An optional
recipe identifier selects one asset. `WG_COMPILER` can select the compiler built from this
checkout. The published registry exposes loading code and an executable authoring script.

`referenceCoverage` is explicit per reference topic. `partial` must never turn a reference
card into a completed example. A ready original analogue may be linked separately. In
particular, voxel surface extraction is not marching cubes, resampling is not simplification,
and a prepared curve is not an interactive spline editor. Colour and UV authoring preserves
attributes in source glTF; visible shader support is a separate capability.

The registry is integration data; all rendering, controls, cards and code views belong to the
portal's existing shared components. Offline assets support orbit/zoom through those controls.
No performance claim is made by this recipe collection.
