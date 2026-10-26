// What the reflection rig lays as the scene's faces: the triangles of a few faces and the radiance each gives. The rig makes
// the global distance field of the triangles (`rigField.ts`); no surface cache holds their light (the scene stage's hits bind
// the stand-ins of `createHitCards`), so a ray that meets a face finds no card and the probes' field answers it.

/** A face of the rig's scene: the triangles it holds — two, nine floats each — and the radiance it gives. */
export type RigFace = { triangles: Float32Array; radiance: readonly [number, number, number] }
