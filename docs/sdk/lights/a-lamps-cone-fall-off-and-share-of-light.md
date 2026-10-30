# A lamp's cone, fall-off and share of light

A spot's edge is a fade, not a line. `innerConeAngle` is the half-angle (radians) of the cone where the light is whole; it fades to nothing at `outerConeAngle`, by the square of a ramp in the cosine between the two. The inner cone is `0` by default, so the light fades across the whole cone; an inner cone as wide as the outer one makes a sharp edge (the fade is a milliradian wide). The inner cone is held between 0 and 88.9 degrees, the outer one at least a milliradian past it.

```ts
light.spot({ outerConeAngle: 0.6, innerConeAngle: 0.3, distance: 20 }) // whole inside 0.3 rad, nothing at 0.6
light.spot({ outerConeAngle: 0.6, innerConeAngle: 0.6 }) // a sharp edge at 0.6 rad
```

A point or spot light falls off as the inverse square of the distance, a square centimetre longer, windowed to nothing at its `distance`: `inverseSquared: true`, the default. With `inverseSquared: false` it falls off by the range alone: one less the square of the distance over the square of `distance`, to the power `radialExponent` (8 by default; greater is a tighter pool), with no other distance weight.

```ts
light.point({ distance: 12, inverseSquared: false }) // exponent 8
light.point({ distance: 12, inverseSquared: false, radialExponent: 2 }) // a wide soft pool
```

Every light takes two shares of what it gives, each from `0` to `1`, `1` by default: `diffuseShare` of its diffuse light (also its light through a thin surface and the light it gives the bounce) and `specularShare` of its specular light (the highlight). A fill light without highlights is `specularShare: 0`; a light that only makes a highlight is `diffuseShare: 0`.

```ts
light.rectArea({ width: 2, height: 1, specularShare: 0 })
light.directional({ diffuseShare: 0.5, specularShare: 1 })
```

| Option | Applies to | Default | Meaning |
| --- | --- | --- | --- |
| `outerConeAngle` | spot | `44°` | Half the outer cone's opening, in radians (44° is 0.7679): the light is nothing at it. |
| `innerConeAngle` | spot | `0` | Half the inner cone's opening, in radians: the light is whole inside it. |
| `inverseSquared` | point, spot | `true` | Falls off as the inverse square of the distance; `false` uses `radialExponent`. |
| `radialExponent` | point, spot | `8` | Exponent of the fall-off when `inverseSquared` is `false`; above 0. |
| `diffuseShare` | every kind | `1` | Share of the diffuse light given, 0 to 1. |
| `specularShare` | every kind | `1` | Share of the specular light given, 0 to 1. |

The compiler's lights (`lights.json`) and a scene file's lights take the defaults. A saved world keeps the options a light sets, nothing for defaults; a world saved before version 5 keeps its cone, its `angle` read as the outer cone and its inner cone that angle less its `penumbra` share.
