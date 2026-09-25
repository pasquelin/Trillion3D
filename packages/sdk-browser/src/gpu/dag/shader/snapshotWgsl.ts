/**
 * SNAPSHOT write: what the GPU reports to the CPU, and the ceiling that bounds it.
 *
 * The snapshot is the only thing a frame brings back down from the GPU. The draw mask stays
 * in place — compute raster reads it where `dagMask` put it —, so what passes here never
 * serves to draw: it serves to BROADCAST. From it the host takes the pages it must load, pin
 * or return to the cache.
 *
 * Each rank is a REQUEST: the page and the priority the host will give it in its upload queue,
 * in a single word (`../request.ts`).
 *
 * The ceiling (`SELECTION_LIST_CAP`, `../layout.ts`) bounds what the frame copy takes. A
 * refused rank sets bit 0: the snapshot is then TRUNCATED, and the frame refuses it whole
 * rather than adopt it amputated. Frame totals lose nothing — they describe the cut, not the
 * list that reports it (`totalsWgsl.ts`).
 *
 * A light cut's frame lists a page ONCE, however many of its views and batches want it: every
 * batch appends to one list (`VIEW_APPEND`) as long as the catalogue, and the same caster asked by
 * each sun level and each batch filled it with repeats, so a late batch's own casters fell past it
 * (`LIST_FULL`) and its coarse pages were drawn again every frame without ever being asked for.
 * Each page keeps its best request of the frame (`askedWord`): the first view to raise it from zero
 * lists the page, and once the frame's cuts are done `dagAskedBest` writes that best word over its
 * entry — the highest priority any view gave it, whatever view won the race.
 */
export const DAG_RELEVE_WGSL = `fn emitOne(page:u32,pixels:f32){
 let priority=quantizePriority(pixels);
 if(isLightCut()&&atomicMax(&work[askedWord(page)],packRequest(page,priority))!=0u){return;}
 emitWord(page,priority,true);
}
/** After a frame's last light cut: each listed page at the best request its views made of it. */
@compute @workgroup_size(64)
fn dagAskedBest(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=min(atomicLoad(&out.count),views[0u].listCap)){return;}
 out.pages[s]=atomicLoad(&work[askedWord(out.pages[s]&((1u<<PAGE_BITS)-1u))]);
}
/** One request word in the sample; past the cap it is dropped, and \`declare\` says truncated. */
fn emitWord(page:u32,priority:u32,declare:bool){
 let slot=atomicAdd(&out.count,1u);
 if(slot>=views[0u].listCap){if(declare){atomicOr(&out.overflow,1u);}return;}
 out.pages[slot]=packRequest(page,priority);
}
/** A request of the view ahead (\`aheadWgsl.ts\`): the lower tier, and never more than half the
 *  cap, so the camera's own requests keep the other half. Past it the request is dropped, never
 *  declared: the sample stays whole for the camera, which alone decides truncation. */
fn emitAhead(page:u32,pixels:f32){
 if(!aheadFull()){emitWord(page,REQUEST_AHEAD|quantizePriority(pixels),false);}
}
/** True once the sample holds half its cap: the view ahead asks for nothing more this frame. */
fn aheadFull()->bool{return atomicLoad(&out.count)>=views[0u].listCap/2u;}
`;
