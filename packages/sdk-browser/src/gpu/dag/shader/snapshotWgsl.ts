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
export const DAG_RELEVE_WGSL = `fn emitOne(page:u32,pixels:f32){
 let slot=atomicAdd(&out.count,1u);
 if(slot>=uni.listCap){atomicOr(&out.overflow,1u);return;}
 out.pages[slot]=packRequest(page,quantizePriority(pixels));
}
`;
