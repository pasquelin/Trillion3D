/** Phong tangent-plane projection (Boubekeur and Alexa, 2008), applied only to the
 * shadow receiver. The visible geometry, depth and silhouettes remain the raster's.
 * https://perso.telecom-paristech.fr/boubek/papers/PhongTessellation/
 * This is a position correction, distinct from Chiang et al.'s 2019 BRDF factor. */
export const SHADING_POINT_WGSL = `
fn shadingPointOffset(P:vec3f,bary:vec3f,p0:vec3f,p1:vec3f,p2:vec3f,n0:vec3f,n1:vec3f,n2:vec3f)->vec3f{
 return -(n0*(bary.x*dot(P-p0,n0))+n1*(bary.y*dot(P-p1,n1))+n2*(bary.z*dot(P-p2,n2)));
}`;
/** Eighth storage binding of the bounce resolve. Three scalar f32 values per pixel,
 * not array<vec3f> (whose stride is 16), preserve the projection without padding. */
export const SHADING_OFFSET_BINDING = 21;
export const SHADING_OFFSET_BYTES = 12;
