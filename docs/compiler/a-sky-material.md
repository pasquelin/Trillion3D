# A sky material

A material is a **sky material** when it is the one a sky dome mesh wears. It is a boolean, `false`
by default, that the compiler gives each material once, the first source naming it winning:

1. `materials` (`--materials=`, `jobs[].materials`) — `sky` named for the material by its exact
   name, `true` or `false`;
2. the material's own glTF `extras`, `"extras": { "sky": true }`; any other value is the document's
   free data: it is ignored, with a `SKY_EXTRA_IGNORED` warning (T3D-W235) on the tables' event;
3. `false`.

The engine shows a sky material as its base colour alone, the colour a mesh of the unlit family shows,
whatever the material declares (its metalness, roughness, normal, occlusion and emissive values and
maps are not read, nor a physical extension): no light reaches it, so the dome keeps the colour its
author gave it, and the sun, the reflections and the shadows do not touch it. The dome is drawn right after the opaque
surfaces are lit and before the atmosphere, the fog and the clouds, which are laid over it.

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/world/',
  materials: { 'sky dome': { sky: true } },
})
```

The same job from the command line:
`trillion3d-compile '--materials={"sky dome":{"sky":true}}' …`. The material table writes
`"sky": true` on the entry of a sky material and nothing on the others. A `sky` that is not a boolean
in `materials` refuses the job (`INVALID_OPTIONS`).

The property rides everywhere the material goes. Each ray-tracing record of a primitive that wears a
sky material carries the sky flag (`RAY_TRACING_FLAG_SKY`), so that the rays through the scene's
triangles leave the dome out unless the project includes the sky (`rayTracingExcludeSky`,
[SDK.md](../SDK.md)). The HLOD proxies keep it: a merged layer that keeps its materials wears the
sources' own, and never collapses a sky material into a plain one that happens to be the same
definition (`collapseEquivalentMaterials`); an actor with its own flattened material (a shell, a
simplified or an atlas-merged actor) is a sky material, `extras.sky` written in its glTF material,
when every object of its cell wears one, and a plain one when the cell holds any other material.
