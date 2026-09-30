/** Phong tangent-plane projection (Boubekeur and Alexa, 2008), applied only to the
 * shadow receiver. The visible geometry, depth and silhouettes remain the raster's.
 * https://perso.telecom-paristech.fr/boubek/papers/PhongTessellation/
 * This is a position correction, distinct from Chiang et al.'s 2019 BRDF factor.
 *
 * The receiver only ever rises off its triangle, on the side its normals face (#1344): on a
 * concave patch the projection falls behind the triangle, under the surface a caster drew, and
 * would shadow the pixel with its own depth — acne. There it keeps the triangle's point, as
 * Hanika's terminator fix does (Hacking the Shadow Terminator, 2021). The normals given carry the
 * side the shading lights: a two-sided surface seen from behind passes them turned. */
export const SHADING_POINT_WGSL = `
fn shadingPointOffset(P:vec3f,bary:vec3f,p0:vec3f,p1:vec3f,p2:vec3f,n0:vec3f,n1:vec3f,n2:vec3f)->vec3f{
 let offset=-(n0*(bary.x*dot(P-p0,n0))+n1*(bary.y*dot(P-p1,n1))+n2*(bary.z*dot(P-p2,n2)));
 let face=cross(p1-p0,p2-p0);
 if(dot(offset,face)*dot(face,n0+n1+n2)<=0.0){return vec3f(0.0);}
 return offset;
}`;
/** Eighth storage binding of the bounce resolve. Three scalar f32 values per pixel,
 * not array<vec3f> (whose stride is 16), preserve the projection without padding. */
export const SHADING_OFFSET_BINDING = 21;
export const SHADING_OFFSET_BYTES = 12;
