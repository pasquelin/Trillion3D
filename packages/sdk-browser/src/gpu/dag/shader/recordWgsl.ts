/**
 * Cold record of a cluster and page residency, read by word in the same buffer.
 *
 * Cone, box and residency lived in a forty-eight-byte structure that the five frame passes read
 * whole, most of the time to take only a flag. The buffer is now an array of words: the opening
 * pass takes cone and box from it, and the four that follow only read a residency bit — one word
 * for thirty-two clusters, hence one cache line for five hundred.
 *
 * Ranks are those of `../layout.ts`, sole source of the layout: the oracle rereads them
 * through the same decoder, which is what keeps it bit-for-bit on the shader.
 */
export const DAG_RECORD_WGSL = `const COLD:u32=13u;
fn coldF(i:u32,k:u32)->f32{return bitcast<f32>(cold[i*COLD+k]);}
fn coneOf(i:u32)->vec4f{return vec4f(coldF(i,0u),coldF(i,1u),coldF(i,2u),coldF(i,3u));}
fn boxMin(i:u32)->vec3f{return vec3f(coldF(i,4u),coldF(i,5u),coldF(i,6u));}
fn hasBox(i:u32)->f32{return coldF(i,7u);}
fn boxMax(i:u32)->vec3f{return vec3f(coldF(i,8u),coldF(i,9u),coldF(i,10u));}
/** Cluster triangles, read as a whole word: frame totals accumulate them. */
fn trianglesOf(i:u32)->u32{return cold[i*COLD+12u];}
/** Residency bits extend the cold records: one word for thirty-two clusters. */
fn isResident(i:u32)->bool{return (cold[views[0u].clusterCount*COLD+(i>>5u)]&(1u<<(i&31u)))!=0u;}
`;
