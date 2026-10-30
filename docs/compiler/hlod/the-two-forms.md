# The two forms

From Node, `prepare(..., { hlod })` takes either form; one function, `resolveHlod`
(`packages/sdk-core/src/contracts/hlodOptions.ts`), turns it into the expert form the compiler reads
(`--hlod=`, `jobs[].hlod`): a string is an exact name, a regular expression is written
`{ "regex": source, "flags": "i" }` — the form the Node command line's `--hlod=` takes in either
form's JSON, for instance `trillion3d-compile '--hlod={"levels":3}' …`. It refuses, in the words
written, a field either form does not hold, `levels` that is not a whole number from 1 to 256, and
the simple form's fields beside `layers`.

The simple form, for most uses, `{ levels }` alone — four levels when it names none: HLOD 0 is the
objects themselves (`instanced`), every coarser level a `merge` layer with the settings of the
reference's default merged layer, the last streamed on its grid like the others (the expert form's
`spatiallyLoaded: false` keeps it always loaded). An object no mark names enters `hlod0`; a mark
(`"extras": { "hlod": "hlod1" }`) names another layer, the expert form's rules assign objects by
name:

```ts
await prepare(source, cache, 'slice', 150000, {
  resourceBaseUrl: '/assets/city/',
  hlod: { levels: 3 },
})
```

| Field | Meaning | Default |
| --- | --- | --- |
| `levels` | The chain's levels, HLOD 0 included, 1 to 256: the first `instanced`, every other `merge`; one level is the objects themselves, instanced, on the first grid | `4` |
| `default` | `none`: an object no mark names has no HLOD, drawn in its cell alone; left out, it enters `hlod0` | left out |

The chain of `{ levels: 3 }` stands for these expert layers; each merged level takes the settings of
the reference's default merged layer — the LOD of each source its lowest, the materials in one atlas
sized by the distance its actor is first drawn, no double-sided material, the normal, roughness,
metallic, specular and emissive images baked — and every other setting its default:

```ts
const merged = {
  builder: 'merge', lodSelection: 'lowest', mergeMaterials: true, textureSizing: 'drawDistance',
  allowDoubleSided: false,
  maps: { normal: true, roughness: true, metallic: true, specular: true, emissive: true },
}
hlod: {
  layers: [
    { name: 'hlod0', builder: 'instanced', parent: 'hlod1', cellSize: 256, loadingRange: 512 },
    { name: 'hlod1', ...merged, parent: 'hlod2', cellSize: 512, loadingRange: 1024 },
    { name: 'hlod2', ...merged, cellSize: 1024, loadingRange: 2048 },
    // To keep the top always loaded: { name: 'hlod2', ...merged, spatiallyLoaded: false }
  ],
  default: 'hlod0',
}
```

One level is the objects themselves, instanced, streamed on the first grid: no merged layer.

```ts
// One level.
hlod: { levels: 1 }
// stands for
hlod: {
  layers: [{ name: 'hlod0', builder: 'instanced', cellSize: 256, loadingRange: 512 }],
  default: 'hlod0',
}
// Never limit the view: the top layer always loaded.
hlod: {
  layers: [{ name: 'hlod0', builder: 'instanced', spatiallyLoaded: false }],
  default: 'hlod0',
}
```
