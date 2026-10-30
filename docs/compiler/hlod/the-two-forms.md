# The two forms

`prepare(..., { hlod })` takes either form; `resolveHlod`
(`packages/sdk-core/src/contracts/hlodOptions.ts`) yields the expert form (`--hlod=`, `jobs[].hlod`). String = exact name; regex = `{ "regex": source, "flags": "i" }`.
CLI: `trillion3d-compile '--hlod={"levels":3}' …`. Refused: unknown fields, `levels` not a whole
number 1..256, simple fields with `layers`.

Simple form `{ levels }`: HLOD 0 is `instanced`, coarser levels `merge` layers with the reference's
default settings; the last is streamed (`spatiallyLoaded: false` keeps it loaded). Unmarked objects
go to `hlod0`; a mark (`"extras": { "hlod": "hlod1" }`) names another layer:

```ts
await prepare(source, cache, 'slice', 150000, {
  resourceBaseUrl: '/assets/city/',
  hlod: { levels: 3 },
})
```

| Field | Meaning | Default |
| - | - | - |
| `levels` | Levels incl. HLOD 0, 1 to 256: first `instanced`, others `merge` | `4` |
| `default` | `none`: unmarked objects have no HLOD | `hlod0` |

`{ levels: 3 }` stands for:

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
