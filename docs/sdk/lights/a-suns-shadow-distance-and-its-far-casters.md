# A sun's shadow distance and its far casters

A directional light's shadows follow the eye. A sun has a **shadow distance**: `shadowDistance`, in
metres, `400` by default, `true` the same, `false` or `0` none. The distance is the sun's own and the
view scales it (`shadowDistanceScale`). It lays the sun's shadow levels and the **edge** where its
distance-field cascade begins; it does not leave a caster out of the shadow maps. The reference's
far-shadow test reaches the subjects it gathers on the CPU, which are no cluster geometry, and every
caster the engine draws is made of clusters: the shadow maps take each of them at any distance,
whether its object casts far shadows or not; no distance-field shadow takes it in their place on the view.

`farShadowCulling` decides whether the sun has a near edge and the distance-field cascade that follows it. The
reference's far-shadow test would act on a caster that is no cluster geometry, of which the engine has none: it has
no switch for the test, nor a per-object one.

The edge lies a little past the distance: the far end of the last of the sun's near shadow levels,
with the overlap that level has into the next when another level follows. The levels are the sun's
own settings, each with the default of a directional light:

| Light option                  | Default  | Meaning                                                                                                                                                                                                                                         |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shadowCascades`              | `4`      | the near levels the distance is cut into (at most the view's `shadowNearLevels`)                                                                                                                                                                |
| `shadowCascadeExponent`       | `3`      | how many times the span of the level before each takes                                                                                                                                                                                          |
| `shadowCascadeTransition`     | `0.1`    | the share of its span a level overlaps into the next                                                                                                                                                                                            |
| `farShadowCascades`           | `0`      | far levels between the distance and `farShadowDistance`, while that is more than a metre farther: counted, never drawn (the shadow maps take every cluster caster at any distance); a light that has some ends its near levels with the overlap |
| `farShadowDistance`           | `3000` m | where those levels end                                                                                                                                                                                                                          |
| `distanceFieldShadows`        | `true`   | whether the distance-field cascade follows the near levels                                                                                                                                                                                      |
| `distanceFieldShadowDistance` | `512` m  | where that cascade ends (`true` the default, `false` none)                                                                                                                                                                                      |
| `distanceFieldShadowTraceDistance` | `100` m | how far a ray of that cascade goes toward the light |
| `distanceFieldShadowRayStartOffsetDepthScale` | `0.003` | the share of a pixel's depth its ray starts off the surface by, over a fixed 2 cm |

The edge at the defaults is 427.0 m (400 m, near plane 0.05 m): the last level starts at 130.03 m and
overlaps 27 m into the cascade that follows; the distance itself from 512 m on.

```js
const sun = light.directional({ castShadow: true, shadowDistance: 600, shadowCascades: 3 })
sun.shadowDistance = 250 // metres, from the next frame; the light is made again, its cached pages drawn again
sun.distanceFieldShadowDistance = false // no distance-field cascade after the near levels
sun.distanceFieldShadowTraceDistance = 50 // metres: a mesh farther than that along the ray casts no shadow
sun.distanceFieldShadowRayStartOffsetDepthScale = 0.005 // raise it where far surfaces shadow themselves
```

The view's settings sit beside them, each an option of `createWorld` too, resolved over the quality
preset like the raster's:

| View option                  | Default               | Meaning                                                                                                       |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `shadowDistanceScale`        | `1` (0 to 2)          | the factor on every sun's distance, so `0.5` halves it; `0` leaves the test nothing to cull                   |
| `farShadowCulling`           | `true`                | whether a sun has a near edge and the distance-field cascade that follows it                                  |
| `shadowNearLevels`           | `10` (0 to 10)        | the most near levels; `0` leaves no edge: nothing is culled                                                   |
| `shadowOverlapScale`         | `1` (0 to 2)          | the factor on the overlap                                                                                     |
| `shadowFarField`             | `true`                | whether the distance-field cascade follows the near levels, where the scene has distance fields               |
| `shadowMaxFarCascades`       | `10`                  | the most far levels a light may count (`farShadowCascades`)                                                   |
| `shadowFarDistanceOverride`  | `0`                   | metres, where far levels end for every light when above 0; no far level is drawn, so it has no visible effect |
| `distanceFieldDistanceScale` | `1` (0.0001 to 10000) | the factor on every light's distance-field distance                                                           |

A distance-field cascade needs two things besides its row: the sun's `distanceFieldShadows`, and a scene
whose meshes have distance fields (the mesh build's `distanceField`, on by default). Without fields the
edge is the distance itself (400 m).

```js
const world = createWorld('viewer', { shadowDistanceScale: 0.85, distanceFieldDistanceScale: 2 })
world.shadows = { farShadowCulling: false } // no near edge, no distance-field cascade, from the next frame
world.shadows = { farShadowCulling: null } // back to the default
```

One more setting of the view is the gate every light's shadow passes: `shadowQuality` (`5`, a whole
number from 0 to 5). At `0` no light takes a shadow, the sun's included: no shadow map, page or trace
is planned, no page pool is made (one made before is freed, its cache with it), the lit passes read no
shadow and drop their shadow code, so a scene that asks for none pays nothing for them. At `1` to `5`
every light takes the same shadow: the shadow maps have one method, so the levels above 0 differ in
nothing today. A light that declares `castsShadow` keeps the declaration: the setting takes the shadow
away, never the flag, and a scene turned back to a level above 0 draws its shadows again from a cache
of its own. The setting does not reach the indirect light's own occlusion of a light (the bounce probes
trace a ray toward each shadow-casting light, as before) nor the clouds' shadow on the sun.

```js
const world = createWorld('viewer', { shadowQuality: 0 }) // no light takes a shadow
world.shadows = { shadowQuality: 3 } // from the next frame: every light does
world.shadows = { shadowQuality: null } // back to the default, 5
world.quality.preset = 'smooth' // the first level: no shadow at all, unless the page set one
```
