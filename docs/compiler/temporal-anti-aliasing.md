# Temporal anti-aliasing

A job sets it two ways, each in the cache key only when named (`args/materials.rs`,
`materialOptions.ts`).

**Scene level** — `temporalAntialiasing` (`--temporal-antialiasing=`,
`jobs[].temporalAntialiasing`): `'off'`, `'low'`, `'medium'`, `'high'` or `'max'`; `true` is
`'max'`, `false` is `'off'`. Written at the top of the manifest; the runtime takes it below the
quality preset, the page (`createWorld(…, { temporalAntialiasing })`, `world.temporalAntialiasing`)
and the editor; the first loaded scene naming one decides. Levels
(`packages/sdk-browser/src/post/taa/levels.ts`): `low` plus kernel, no spatial anti-aliaser,
flicker rejection, resurrection or reprojection field; `medium` spatial anti-aliaser at three
samples a side and history resurrection; `high` kernel moving its far neighbour, flicker rejection
and reprojection field; `max` (default) eight samples a side, history at twice display resolution.
At most 16 samples per display pixel, 4 per 200 % history pixel. Presets `smooth`, `balanced`,
`fine` write `low`, `medium`, `high`; `cinematic` writes `max`; `max` writes nothing.

**Material responsiveness** — trust in the history on a material's pixels: `'off'` (default),
`'medium'` or `'full'`, for effects whose motion vectors do not follow their detail (sparks).

- `'medium'`: pixels count as moving for the flicker measure, are left out of thin geometry
  detection, and the shading rejection reads colour blurred over 3×3; history kept.
- `'full'`: as `'medium'`, and history restarts every image, never resurrected. Small features
  only. Level `low`, or an image with no frame to resurrect from, reads `'full'` as `'medium'`.

A blended or transmissive layer carries its material's level onto the pixels it marks; a pixel takes
the largest of its opaque surface's and its layers'. A layer marks (as UE's translucent
clipped-depth pass) only if `translucencyPass: 'beforeDepthOfField'`, blended `normal`, `additive`
or `multiply`, where opacity is above 0 and under `opacityMaskClipValue` (default 0.3333) plus
1/255, in front of the opaque scene. GPU particle systems name none. A material's level comes from
the first source naming it:

1. `materials` (`--materials=`, `jobs[].materials`): `responsive` by exact material name: a level,
   `true` is `'full'`, `false` is `'off'`;
2. `responsive` (`--responsive=`, `jobs[].responsive`): `'full'` for the materials of matched
   objects: a string is the node's exact name, `{ "regex", "flags" }` a regular expression on it,
   `{ node, mesh, material, extras }` an HLOD rule match (all named fields must match); naming
   `material` keeps only those materials;
3. the material's glTF `"extras": { "responsive": true }` or `{ "responsive": "medium" }`: as in 1;
   another value is ignored with a `RESPONSIVE_EXTRA_IGNORED` warning;
4. `'off'`.

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/sparks/',
  temporalAntialiasing: 'high',
  responsive: { material: /^spark/ },
  materials: {
    'spark trail': { responsive: false },
    smoke: { responsive: 'medium' },
    'hud text': { responsive: 'full' },
  },
})
```

CLI: `trillion3d-compile --temporal-antialiasing=high '--responsive={"material":{"regex":"^spark"}}'
'--materials={"spark trail":{"responsive":false},"smoke":{"responsive":"medium"}}' …`.

The material table (version 6) writes `"responsive": "medium"` or `"full"` on entries above `off`;
the `taa-material-history` view shows the code in grey (black none, a third `medium`, white
`full`). `INVALID_OPTIONS` (in a batch, that job alone): a level outside the five; a `responsive`
outside `'off'`, `'medium'`, `'full'`, `true`, `false`; a field `materials` does not hold; a match
naming nothing; a regular expression that does not compile or reads differently from the host (flag
other than `i`, `m`, `s`, `g`, `u`, `y`, or `i` on a source with a non-ASCII letter).
