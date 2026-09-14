/** Bright, stable display colors derived from integer triangle IDs. */
export const TRIANGLE_PALETTE_WGSL = `
fn triangleHash(id:u32)->u32{
 var x=id+0x9e3779b9u;
 x=(x^(x>>16u))*0x7feb352du;
 x=(x^(x>>15u))*0x846ca68bu;
 return x^(x>>16u);
}
fn stableTriangleId(cluster:u32,triangle:u32)->u32{return cluster^triangleHash(triangle);}
fn hashColor(id:u32)->vec3f{
 let h=triangleHash(id);
 let hue=f32(h&65535u)/65535.0;
 let saturation=0.65+0.25*f32((h>>16u)&255u)/255.0;
 let value=0.78+0.20*f32((h>>24u)&255u)/255.0;
 let channels=abs(fract(vec3f(hue,hue+0.6666667,hue+0.3333333))*6.0-vec3f(3.0));
 return value*mix(vec3f(1.0),clamp(channels-vec3f(1.0),vec3f(0.0),vec3f(1.0)),saturation);
}`;
