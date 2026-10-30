# Hair strands: debug views
Four diagnostic views (`world.diagnostic.mode`) draw over the image: `hair-light-bounds` the statistics of the strands (the components of the fibre, the voxelization, the atlas of the deep shadows) and the bounds the settings ask for; `hair-deep-opacity-maps` the same, and the depth and the layers of a deep shadow side by side; `hair-macro-group-screen-rect` a green frame around the pixels each macro group of strands covers, and one around all of them; `hair-voxels-density` the strands' count along the ray of each pixel through the voxels, from blue to red, and the box of each volume. The name of the view is written at the bottom. They need `hairStrands` and a scene that carries strands (the deep shadows a light that casts them, `castHairDeepShadow`).

| Setting | Default | Meaning |
| --- | --- | --- |
| `hairCastShadowWhenOutOfViewDebug` | `false` | in every view: the view frustum in blue, the bound of each directional light in purple, the box of each groom out of view in the light's space green where it reaches the frustum and yellow where it does not, and in the world in red |
| `hairDeepShadowDebugIndex` | `0` | rank of the deep shadow `hair-deep-opacity-maps` draws; it draws nothing past the slots the atlas holds |
| `hairDeepShadowDebugScale` | `20` | divisor of the layers' values in that view |
| `hairDeepShadowDebugMacroBounds` | `false` | the box of each macro group, in the views of the bounds and of the deep shadows |
| `hairDeepShadowDebugShadowBounds` | `false` | the frustum of each deep shadow, in the same views |
| `hairVoxelDebugTraversal` | `'linear'` | `'linear'` a voxel a step, `'mip'` through the levels of the pages |
| `hairVoxelDebugDrawVoxels` | `true` | draw the strands' count |
| `hairVoxelDebugDrawPages` | `false` | draw the first page that holds voxels along the ray instead, its coordinates over 12 as the colour |
| `hairVoxelDebugForcedMip` | `-1` | from 0 to 8, the level of the pages every step reads; below 0 the step picks it |

```js
// The voxels of the strands marched through their mip levels, with the macro groups' boxes drawn on the deep shadows view.
const world = createWorld('viewer', {
  hairStrands: true,
  hairVoxelDebugTraversal: 'mip',
  hairDeepShadowDebugMacroBounds: true,
})
world.diagnostic.mode = 'hair-voxels-density'
```
