# Hair strands: G-buffer write
`hairWriteGBufferData` (`1`, from 0 to 3) writes the strands into the surfaces once they are laid on the image, for the passes that read the surfaces next (the reflections and the occlusion of the following image, the passes that tell hair pixels apart). `0` writes nothing; `1` a placeholder: the tangent (0, 0, 1) as the normal, no roughness and the hair shading model, no colour; `2` the mean tangent of the pixel's strand samples as the normal and their mean roughness; `3` the whole surface, the mean base colour too, and takes the opaque depth to the nearest strand's. A pixel written is of the hair shading model, which has no specular lobe, so no reflection is traced for it. The strands' specular and backlit share stay in their samples: the surfaces hold no place for them. It needs `hairStrands`.

```js
// Strands that write their normal, roughness and colour into the surfaces and their depth into the opaque depth.
const world = createWorld('viewer', { hairStrands: true, hairWriteGBufferData: 3 })
```
