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
 * A light cut's frame asks for a page ONCE, however many of its views and batches want it: every
 * batch appends to one list (`VIEW_APPEND`) as long as the catalogue, and the same caster asked by
 * each sun level and each batch filled it with repeats, so a late batch's own casters fell past it
 * (`LIST_FULL`) and its coarse pages were drawn again every frame without ever being asked for.
 * The test reads the page's bit before the atomic (`firstAsk`), as the shading's page requests do.
 */
export const DAG_RELEVE_WGSL = `fn emitOne(page:u32,pixels:f32){
 if(isLightCut()&&!firstAsk(page)){return;}
 emitWord(page,quantizePriority(pixels),true);
}
/** True for the first ask of \`page\` in the frame's light cuts: its bit behind the per-view words
 *  (\`dagWorkLayout\`, \`asked\`), cleared by the host at the frame's first cut. */
fn firstAsk(page:u32)->bool{
 let word=drawnGroupsMax()+1u+(page>>5u);let bit=1u<<(page&31u);
 if((atomicLoad(&work[word])&bit)!=0u){return false;}
 return (atomicOr(&work[word],bit)&bit)==0u;
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
