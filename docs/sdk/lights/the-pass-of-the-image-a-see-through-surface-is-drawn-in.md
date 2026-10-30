# The pass of the image a see-through surface is drawn in

A see-through surface is drawn apart from the scene and laid over the image once the depth of field
has read it, so no blur reaches it (`translucencyPass: 'afterDepthOfField'`, the default).

- `'beforeDepthOfField'`: laid onto the scene before the depth of field, blurred with it (a haze, a
  distant window).
- `'afterMotionBlur'`: laid over the image after the temporal anti-aliasing and motion blur have read
  it, so neither smears it (a hologram, a HUD element in the world); the temporal pass does not
  anti-alias its edges.

A particle pool takes the same setting in its spec (`ParticlePoolSpec.translucencyPass`). Without a
depth of field the first two passes draw alike; the third is its own pass whatever the image. The
scene pays a second set of translucency targets and an image of the display's size only while one of
its surfaces or pools names `'afterMotionBlur'`.

```js
material.meshStandard({ transparent: true, opacity: 0.3, translucencyPass: 'beforeDepthOfField' }) // blurred with the scene
material.meshStandard({ transparent: true, opacity: 0.5, translucencyPass: 'afterMotionBlur' }) // never smeared by the temporal pass nor the motion blur
new ParticlePool({ capacity: 64, translucencyPass: 'afterMotionBlur' }) // a pool's, in its spec
```
