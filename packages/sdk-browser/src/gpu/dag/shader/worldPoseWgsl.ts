/** A primitive's world pose, and its frustum planes' first vec4 in \`frames\`, per view slot. */
export const DAG_WORLD_POSE_WGSL = `
fn worldPose(w:u32)->mat4x4f{
 let at=rowOf(w)*4u;
 return mat4x4f(worlds[at],worlds[at+1u],worlds[at+2u],worlds[at+3u]);
}
fn planesOf(w:u32)->u32{return slotOf(w)*FRAME;}
`;
