# Particles

A compute pass steps the pools (`particles/gpu/webgpuParticles.ts`) and one instanced draw a
pool puts them over the lit image after the transparents (`particles/gpu/webgpuParticleDraw.ts`),
or over the display colour of an image drawn without the visibility buffer; both fade each disc
on the opaque depth, never hard-edged: by the difference of the two depths along the view, over
the pool's `softness`. A disc lies across the view, its axes the camera's right and up, and turns by its
rotation; its size, rotation and colour are its own (`ParticleLook`), the pool's where it has none,
and its colour holds to its death unless the pool's `fade` says what it is multiplied by there.
