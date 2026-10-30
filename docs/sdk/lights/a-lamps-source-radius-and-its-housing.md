# A lamp's source radius and its housing

`SceneLight.emitterRadius` (metres, positive, below `range`, point and spot only) is the radius of
the source sphere: it sets how soft the light's shadow is and how the lamp lights a surface. A
lamp's housing (a lantern glass, a shade) that must not put its own light out is a mesh with
`mesh.castShadow = false`, as any mesh. Imported lamps:
[COMPILER.md](../../compiler/internals.md#lightsjson--the-lamps-of-the-source-file).
