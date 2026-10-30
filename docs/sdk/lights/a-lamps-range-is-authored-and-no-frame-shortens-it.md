# A lamp's range is authored, and no frame shortens it

`range` is the lamp's attenuation radius in metres: influence ends there through the window
`(1 − (d/range)⁴)²`, and a `point` or `spot` shadow map is built to it. The page sets it
(`light.distance`); unset, the world derives one from the scene's extent. Every path (the world, a
source file, `addLight`, `setLight`) stores it as-is: no exposure, curve or threshold shortens it.

`capability.lighting(world)` reports what the active engine applies, `{ shadows, reason? }`, not what
the contract accepts; declared lights, the lighting view and node moves always apply at the next
frame; `reason` names in one sentence what is not applied.
