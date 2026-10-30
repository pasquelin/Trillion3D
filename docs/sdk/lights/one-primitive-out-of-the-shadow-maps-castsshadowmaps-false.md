# One primitive out of the shadow maps: `castsShadowMaps = false`

A model's mesh of several primitives (one material each) is a group of one mesh per primitive; each has its own `castsShadowMaps`, `true` by default. Set `false`, that primitive leaves the lights' shadow maps and nothing else, while another primitive of its model casts into them: the distance fields, the global illumination, the contact shadows and the views still hold it, and it still receives shadows. A model none of whose primitives casts into the maps casts nothing at all, the distance fields' shadows included, as one mesh does (a one-primitive model set `false` is such a model). `castShadow` gates first, whole: a mesh with `castShadow = false` casts none whatever `castsShadowMaps` says. A translucent surface is never in the shadow maps, so the switch is for opaque and masked primitives.

```ts
// `model` is a loaded model; the thin trim along a cornice costs pages of shadow for a shadow
// nobody reads: out of the shadow maps, still drawn and still lit, the rest of the model casting.
const trim = model.getObjectByName('Cornice_Trim')!
trim.castsShadowMaps = false

const rail = object.mesh(geometry.box(2, 0.02, 0.02)) // a mesh of your own: alone, it casts nothing
rail.castsShadowMaps = false
```

A write is told to the world like `castShadow`: the shadow cache stales the pages the primitive was drawn in, and a row of a streamed cell takes its source mesh's value. A clone, a model node and a saved scene keep it (a saved scene writes it only when `false`).
