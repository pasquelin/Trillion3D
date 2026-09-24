/**
 * Cold record of a cluster, the working table and page residency, read by word in one buffer.
 *
 * Cone, box and residency lived in a forty-eight-byte structure that the five frame passes read
 * whole, most of the time to take only a flag. The buffer is now an array of words: the working
 * table first — one word per page, its placement —, then the residency bits — one word for
 * thirty-two pages, hence one cache line for five hundred —, then the cold records, one per
 * UNIQUE cluster, which the opening pass reads cone and box from.
 *
 * A page reaches its hot and cold records through `recordOf`: its index plus its placement's
 * shift, the third frame word (`../worlds.ts`). Ranks are those of `../layout.ts`, sole source of
 * the layout: the oracle rereads them through `../records.ts`, which keeps it bit-for-bit on the
 * shader.
 */
export const DAG_RECORD_WGSL = `const COLD:u32=13u;
fn pageWorld(i:u32)->u32{return cold[i];}
/** Shared record of page \`i\` of primitive \`w\`: a wrapping add, as \`recordOf\` on the host. */
fn recordOf(i:u32,w:u32)->u32{return i+bitcast<u32>(frames[w*FRAME+6u].z);}
fn coldBase()->u32{let n=views[0u].clusterCount;return n+((n+31u)>>5u);}
fn coldF(r:u32,k:u32)->f32{return bitcast<f32>(cold[coldBase()+r*COLD+k]);}
fn coneOf(r:u32)->vec4f{return vec4f(coldF(r,0u),coldF(r,1u),coldF(r,2u),coldF(r,3u));}
fn boxMin(r:u32)->vec3f{return vec3f(coldF(r,4u),coldF(r,5u),coldF(r,6u));}
fn hasBox(r:u32)->f32{return coldF(r,7u);}
fn boxMax(r:u32)->vec3f{return vec3f(coldF(r,8u),coldF(r,9u),coldF(r,10u));}
/** Cluster triangles, read as a whole word: frame totals accumulate them. */
fn trianglesOf(r:u32)->u32{return cold[coldBase()+r*COLD+12u];}
/** Residency bits follow the working table: one word for thirty-two pages. */
fn isResident(i:u32)->bool{return (cold[views[0u].clusterCount+(i>>5u)]&(1u<<(i&31u)))!=0u;}
`;
