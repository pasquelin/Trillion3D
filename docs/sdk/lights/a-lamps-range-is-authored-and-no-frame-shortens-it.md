# A lamp's range is authored, and no frame shortens it

`range` = lamp attenuation radius, metres: influence ends there through window `(1 − (d/range)⁴)²`,
and a `point` or `spot` shadow map is built to it. The page sets it (`light.distance`); unset, the
world derives one from scene extent. Every path (world, source file, `addLight`, `setLight`) stores
it as is: no exposure, curve or threshold shortens it.

`capability.lighting(world)` reports what the active engine applies, `{ shadows, reason? }`, not
what the contract accepts; declared lights, lighting view and node moves always apply next frame;
`reason` names in one sentence what is not applied.
