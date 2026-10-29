// What the reflection rig lays as the scene's faces: the triangles of a few faces and the radiance each gives. The rig makes
// the global distance field of the triangles (`rigField.ts`) and a surface cache that lights them (`rigCache.ts`: six cards for
// each face, its radiance as their final light), so a ray that meets a face reads its light as the engine's hits do.

/** A face of the rig's scene: the triangles it holds — any number, nine floats each, in metres, both sides count — and the radiance it gives, `frame.proxy.faces[k]`. */
export type RigFace = { triangles: Float32Array; radiance: readonly [number, number, number] }
