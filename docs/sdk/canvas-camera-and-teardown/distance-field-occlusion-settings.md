# Distance field occlusion settings

`world.distanceFieldOcclusion`: sky light occlusion by distance fields, also a `createWorld` option:
how much sky each pixel sees, from cones traced against the global field and meshes' own fields
([ENGINE.md](../../engine/distance-fields.md#distance-fields)). Drawn when the sky light is movable
and casts shadows, the bounce is off (on: its probes carry the sky, screen probes its visibility)
and a mesh built a distance field.

The sky light then lights each pixel along its sky's most open way, by the sky share seen: diffuse
read along a normal turned toward that direction, scaled by visibility; rough-surface sky
reflection occluded by the open cone (`distanceFieldOcclusionSpecularMode`: 0 by sky share seen, 1
by intersection of reflection cone and open cone; `skyLightSpecularOcclusionStrength` its strength).
Light's own settings shape it: `occlusionMaxDistance`, `contrast`, `occlusionExponent`,
`minOcclusion`, `occlusionTint`, `occlusionCombineMode`.

Settings and defaults; lengths in centimetres:

- `distanceFieldOcclusion` (`true`)
- `distanceFieldOcclusionQuality` (`2`: 0 off, 1 global field only, 2 meshes' fields too)
- `distanceFieldOcclusionObjects` (`true`)
- `distanceFieldOcclusionStepExponentScale` (`0.5`)
- `distanceFieldOcclusionMaxViewDistance` (`20000`, held to 65000)
- `distanceFieldOcclusionViewFadeDistanceScale` (`0.7`)
- `distanceFieldOcclusionSampleSet` (`1`)
- `distanceFieldOcclusionJitterConeDirections` (`false`), `distanceFieldOcclusionUseJitter` (`true`)
- `distanceFieldOcclusionTraverseMips` (`true`)
- `distanceFieldOcclusionUseHistory` (`true`), `distanceFieldOcclusionHistoryStabilityPass` (`true`),
  `distanceFieldOcclusionHistoryWeight` (`0.85`), `distanceFieldOcclusionHistoryDistanceThreshold`
  (`30`)
- `distanceFieldOcclusionSpecularMode` (`1`)
- `skyLightSpecularOcclusionStrength` (`1`, at least 0.1 where used)
- `distanceFieldOcclusionObjectsPerCullTile` (`512`)

A write names changed settings, `null` restores a default; a value of another kind is refused by
name. A scene whose meshes built no distance field is untouched.

```js
const world = createWorld('viewer', { distanceFieldOcclusionQuality: 1 }) // the global field alone
world.distanceFieldOcclusion = { distanceFieldOcclusionMaxViewDistance: 40000 } // light pixels up to 400 m
world.distanceFieldOcclusion = { distanceFieldOcclusionUseHistory: false } // no temporal filter
world.distanceFieldOcclusion = { distanceFieldOcclusionQuality: null } // back to the default, 2
```
