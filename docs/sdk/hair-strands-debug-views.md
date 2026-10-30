# Hair strands: debug views

Four diagnostic views (`world.diagnostic.mode`) draw over the image:

- `hair-light-bounds`: the strands' statistics (fibre components, voxelization, deep shadow atlas)
  and the bounds the settings ask for;
- `hair-deep-opacity-maps`: the same, and a deep shadow's depth and layers side by side;
- `hair-macro-group-screen-rect`: a green frame around the pixels each macro group of strands
  covers, and one around all of them;
- `hair-voxels-density`: the strands' count along each pixel's ray through the voxels, blue to red,
  and each volume's box.

The view's name is written at the bottom. They need `hairStrands` and a scene that carries strands
(the deep shadows a light that casts them, `castHairDeepShadow`).

| Setting | Default | Meaning |
| - | - | - |
| `hairCastShadowWhenOutOfViewDebug` | `false` | in every view: the view frustum in blue, each directional light's bound in purple, each out-of-view groom's box in the light's space green where it reaches the frustum and yellow where it does not, and in the world in red |
| `hairDeepShadowDebugIndex` | `0` | rank of the deep shadow `hair-deep-opacity-maps` draws; nothing past the slots the atlas holds |
| `hairDeepShadowDebugScale` | `20` | divisor of the layers' values in that view |
| `hairDeepShadowDebugMacroBounds` | `false` | each macro group's box, in the bounds and deep shadow views |
| `hairDeepShadowDebugShadowBounds` | `false` | each deep shadow's frustum, in the same views |
| `hairVoxelDebugTraversal` | `'linear'` | `'linear'` a voxel a step, `'mip'` through the pages' levels |
| `hairVoxelDebugDrawVoxels` | `true` | draw the strands' count |
| `hairVoxelDebugDrawPages` | `false` | draw instead the first page holding voxels along the ray, its coordinates over 12 as the colour |
| `hairVoxelDebugForcedMip` | `-1` | 0 to 8, the pages' level every step reads; below 0 the step picks it |

```js
// The voxels of the strands marched through their mip levels, with the macro groups' boxes drawn on the deep shadows view.
const world = createWorld('viewer', {
  hairStrands: true,
  hairVoxelDebugTraversal: 'mip',
  hairDeepShadowDebugMacroBounds: true,
})
world.diagnostic.mode = 'hair-voxels-density'
```
