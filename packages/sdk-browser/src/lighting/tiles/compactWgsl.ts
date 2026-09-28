/**
 * The compaction of a tile's lights into its two lists (`./shader.ts`): `words` mask words per
 * slice, one bit per light of a batch of `words * 32`, then, with `pool`, the slices past their
 * list written into the view's pool (#849).
 *
 * A walk tests the scene's lights batch by batch, one per thread, and each kept thread writes its
 * light at what the batches before kept plus the bit count before it: the order is increasing and
 * determined, so the frame is too. The first walk fills the lists, `TILE_LIGHTS` each, and counts
 * true. A slice that counted more reserves room for all of them in the pool — one atomic
 * addition, by thread zero —, names its start in its list's first word, and a second walk writes
 * them there, in the same order: the tile reads exactly the lights that reach it, however many.
 * A pool with no room left raises its overflow word and gives the slice `TILE_NO_SLICE`: that
 * tile walks every light, exactly, and the engine names the overflow (`./pool.ts`).
 */
export const tileCompactWgsl = (words: number, pool: boolean) => `
/** One mask, two slices: the first ${words} words are the opaque list's, the next those of
 *  the blend list. One rank function knows how to read them, indexed by the start of its
 *  slice — no pointer into workgroup memory, which not every device takes as a parameter. */
const OPAQUE_MASK:u32=0u;
const BLEND_MASK:u32=${words}u;
var<workgroup> hits:array<atomic<u32>,${2 * words}u>;
/** What the batches before kept, and, per slice, where the walk writes and how many it has room
 *  for: its list, then its slice of the pool. */
var<workgroup> kept:vec2u;
var<workgroup> start:vec2u;
var<workgroup> room:vec2u;
/** Rank of a kept light: the number of kept bits before it in the same slice. */
fn rankBefore(mask:u32,lane:u32)->u32{
 let word=mask+lane/32u;
 var rank=0u;
 for(var before=mask;before<word;before++){rank=rank+countOneBits(atomicLoad(&hits[before]));}
 return rank+countOneBits(atomicLoad(&hits[word])&((1u<<(lane%32u))-1u));
}
fn maskHolds(mask:u32,lane:u32)->bool{
 return (atomicLoad(&hits[mask+lane/32u])&(1u<<(lane%32u)))!=0u;
}
/** Adds a full batch's totals to \`kept\` and clears its masks: thread zero, between batches. */
fn clearedKept(){
 kept+=vec2u(maskTotal(OPAQUE_MASK,${words}u),maskTotal(BLEND_MASK,${words}u));
 for(var word=0u;word<${2 * words}u;word++){atomicStore(&hits[word],0u);}
}
/** Kept bits of a slice's first \`words\` mask words: those a batch's lights fill. */
fn maskTotal(mask:u32,words:u32)->u32{
 var total=0u;
 for(var w=0u;w<words;w++){total=total+countOneBits(atomicLoad(&hits[mask+w]));}
 return total;
}
/** One walk over the scene's \`count\` lights, every thread in step: each kept light is written at
 *  its rank after what the batches before kept, while its slice has room. */
fn walkLights(lane:u32,count:u32,hasOpaque:bool,seesSky:bool){
 for(var first=0u;first<count;first+=${words * 32}u){
  let index=first+lane;
  if(index<count){
   let light=lights.items[index];
   // A directional light reaches everywhere: no tile bound can reject it. The others are kept
   // only if their range sphere, brought into the pass's frame, touches the slice.
   var keep=vec2<bool>(hasOpaque,true);
   if(!isSun(light)){keep=sliceHits(light.positionRange.xyz-view.origin.xyz,light.positionRange.w,hasOpaque,seesSky);}
   let bit=1u<<(lane%32u);
   if(keep.x){atomicOr(&hits[OPAQUE_MASK+lane/32u],bit);}
   if(keep.y){atomicOr(&hits[BLEND_MASK+lane/32u],bit);}
  }
  workgroupBarrier();
  // Parallel compact, each light at its rank after what the batches before kept: increasing
  // order, as a single-thread loop. A rank past the slice's room is not written.
  if(index<count&&maskHolds(OPAQUE_MASK,lane)){let at=kept.x+rankBefore(OPAQUE_MASK,lane);if(at<room.x){tiles[start.x+at]=index;}}
  if(index<count&&maskHolds(BLEND_MASK,lane)){let at=kept.y+rankBefore(BLEND_MASK,lane);if(at<room.y){tiles[start.y+at]=index;}}
  // Another batch follows: thread zero counts what this one kept, then clears its mask.
  if(first+${words * 32}u<count){workgroupBarrier();if(lane==0u){clearedKept();}workgroupBarrier();}
 }
}${pool ? POOL_WGSL : ''}`;

/** The view's pool: where it starts after the tile records, its room, the words reserved this
 *  frame and the overflow word, all four sampled by `./pool.ts`. */
const POOL_WGSL = `
struct TilePool{start:u32,capacity:u32,head:atomic<u32>,overflow:atomic<u32>,}
@group(0) @binding(4) var<storage,read_write> pool:TilePool;
/** The two true counts, which thread zero hands to every thread after the first walk. */
var<workgroup> counted:vec2u;
/** Thread zero, for a slice that counted \`total\` lights: past its list, room for all of them in
 *  the pool, its start named in the list's first word \`slot\` — or \`TILE_NO_SLICE\`, the pool's
 *  overflow raised, when the pool has no room left. A slice within its list writes nothing more. */
fn spill(slice:u32,total:u32,slot:u32){
 room[slice]=0u;
 if(total<=TILE_LIGHTS){return;}
 let at=atomicAdd(&pool.head,total);
 var first=TILE_NO_SLICE;
 if(at<pool.capacity&&total<=pool.capacity-at){first=pool.start+at;room[slice]=total;}
 else{atomicStore(&pool.overflow,1u);}
 start[slice]=first;
 tiles[slot]=first;
}`;

/** The second walk of a tile a slice of which passed its list; nothing for any other tile. */
export const tileSpillWgsl = (words: number) => `
 // A slice past its list: room in the pool for every light it counted, then the same walk
 // writes them there, in the same order (#849).
 let total=workgroupUniformLoad(&counted);
 if(max(total.x,total.y)>TILE_LIGHTS){
  // The first walk's list writes land before thread zero names the slices over them.
  storageBarrier();
  if(lane<${2 * words}u){atomicStore(&hits[lane],0u);}
  if(lane==0u){kept=vec2u(0u);spill(0u,total.x,base+TILE_OPAQUE_BASE);spill(1u,total.y,base+TILE_BLEND_BASE);}
  workgroupBarrier();
  walkLights(lane,count,hasOpaque,seesSky);
 }`;
