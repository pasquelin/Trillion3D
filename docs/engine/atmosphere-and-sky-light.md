# Atmosphere and sky light

The `atmosphere` part of the sky module is a planet's air lit by the sun: a term of the one lighting
model like the fog. Coefficients and defaults: `packages/sdk-core/src/scene/core/atmosphere.ts` (an
Earth-like planet of 6360 km, air 60 km thick, ground at `y = groundHeight`, 0 by default, its top at
`groundPosition`, `[0, 0]` by default). Planet distances are kilometres, the scene stays in metres.
Where it is on, `scene.background` is not shown.

Parts:

- [Air, lights and tables](atmosphere-and-sky-light/air-lights-and-tables.md): units, two lights, the tables, shade on the air
- [Clouds and the air](atmosphere-and-sky-light/clouds-and-the-air.md): cloud shade on the air, sky occlusion map, no-atmosphere clouds, time, density bound, empty-space table
- [Cloud sizes, drawing and orthographic views](atmosphere-and-sky-light/clouds-drawing-and-orthographic.md)
- [Sky light, capture and sky meshes](atmosphere-and-sky-light/sky-light.md): the sky light, real-time capture, sky pass, sky meshes
- [Reflections and the captured-scene sky light](atmosphere-and-sky-light/sky-light-captured-scene.md)
