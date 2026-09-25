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
 */
export const DAG_RELEVE_WGSL = `fn emitOne(page:u32,pixels:f32){emitWord(page,quantizePriority(pixels),true);}
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
