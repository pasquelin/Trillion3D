# A lamp's source radius and its housing

`SceneLight.emitterRadius` (metres, positive, below `range`, point and spot only): source sphere
radius; sets shadow softness and how the lamp lights a surface. A housing (lantern glass, shade) that
must not block its own light is a mesh with `mesh.castShadow = false`, as any mesh. Imported lamps:
[COMPILER.md](../../compiler/internals.md#lightsjson--the-lamps-of-the-source-file).
