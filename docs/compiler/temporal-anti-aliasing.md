# Temporal anti-aliasing

The temporal anti-aliasing blends each image into a history that follows the surfaces as they move.
A job sets it two ways, both part of its cache key only when named — a job naming none of the
options compiles as before, its key unchanged (`args/materials.rs`, `materialOptions.ts`).

**The scene's level** — `temporalAntialiasing` (`--temporal-antialiasing=`,
`jobs[].temporalAntialiasing`): `'off'`, `'low'`, `'medium'`, `'high'` or `'max'`, `true` standing
for `'max'` and `false` for `'off'`. The compiler writes it at the top of the manifest; the runtime
takes it as the scene's setting, below the quality preset, the page
(`createWorld(…, { temporalAntialiasing })`, `world.temporalAntialiasing`) and the editor — the first loaded scene
naming one decides. The levels are the anti-aliasing scalability levels 0 to 3 from `low`
(`packages/sdk-browser/src/post/taa/levels.ts`): `low` a plus kernel, no spatial anti-aliaser, no
flicker rejection, no resurrection, no reprojection field; `medium` the spatial anti-aliaser at
three samples a side and the history's resurrection; `high` the kernel moving its far neighbour, the
flicker rejection and the reprojection field; `max` eight samples a side and a history at twice the
display's resolution, the default. A display pixel holds 16 samples at most, a pixel of the 200 %
history 4; a still view is held once its history is whole. The quality presets `smooth`, `balanced`,
`fine` write `low`, `medium`, `high`; `max` writes nothing and `cinematic` writes `max`.

**Each material's responsiveness** — how far the temporal anti-aliasing trusts the history on its
pixels: `'off'` (the default: the normal accumulation), `'medium'` or `'full'`. It is meant for
effects whose motion vectors do not follow their detail, small moving features such as sparks; a
surface whose motion vectors are right stays `'off'`.

- `'medium'` reads the material's pixels as a pixel animation: they count as moving for the flicker
  measure, are left out of the thin geometry detection, and the shading rejection reads their colour
  blurred over its 3×3, so their history is rejected more aggressively, small features above all.
  They keep their history.
- `'full'` is the same, and the pixel's history restarts every image, as a disoccluded pixel's does,
  and is never resurrected from an older frame: the current image alone, its edges smoothed by the
  spatial anti-aliaser. Use it for small features only — a large surface at `'full'` shimmers with
  the camera's jitter. The restart rides the resurrection: a level that runs none (`low`), and an
  image with no frame yet to resurrect from, read `'full'` as `'medium'`.

It holds for opaque and blended surfaces alike: a blended or transmissive layer carries its
material's level onto the pixels it marks, a pixel taking the largest of its opaque surface's and
its layers'. A layer marks as the reference's translucent clipped-depth pass does: only a layer of
`translucencyPass: 'beforeDepthOfField'`, blended `normal`, `additive` or `multiply`, only where its
opacity is above 0 and under its material's `opacityMaskClipValue` (0.3333 by default) plus a 255th
— the faint pixels the temporal pass would smear — and only in front of the opaque scene; a layer of
the other passes marks none. A GPU particle system names none. The compiler gives each material its
level once, the first source naming it winning:

1. `materials` (`--materials=`, `jobs[].materials`) — `responsive` named for the material by its
   exact name: a level, `true` standing for `'full'` and `false` for `'off'`;
2. `responsive` (`--responsive=`, `jobs[].responsive`) — `'full'` for the materials of every object
   the match takes: a string is the node's exact name, `{ "regex", "flags" }` a regular expression
   on it, an object `{ node, mesh, material, extras }` as an HLOD rule matches (every field named
   must match); a match naming `material` keeps only the materials it names;
3. the material's own glTF `extras`, `"extras": { "responsive": true }` or `{ "responsive": "medium"
   }`: a level, `true` or `false` as in 1; any other value is the document's free data: it is
   ignored, with a `RESPONSIVE_EXTRA_IGNORED` warning on the tables' event;
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

The same job from the command line:
`trillion3d-compile --temporal-antialiasing=high '--responsive={"material":{"regex":"^spark"}}' '--materials={"spark trail":{"responsive":false},"smoke":{"responsive":"medium"},"hud text":{"responsive":"full"}}' …`.
The material table (version 6) writes `"responsive": "medium"` or `"full"` on each entry above
`off`, and the runtime's `taa-material-history` view shows the code each pixel carries in grey —
black none, a third a pixel animation, white a pixel animation whose history restarts. A level that
is none of the five, a `responsive` that is none of `'off'`, `'medium'`, `'full'`, `true`, `false`
(in `materials` or in a material's extras), a field `materials` does not hold, a match naming
nothing, or a regular expression that does not compile — or that the compiler would read otherwise
than the host: a flag other than `i`, `m`, `s`, `g`, `u`, `y`, or `i` on a source holding a letter
past ASCII — refuses the job (`INVALID_OPTIONS`); in a batch, that job alone.
