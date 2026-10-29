import { rasterModule } from './rasterWgsl.ts'
import { HAIR_THREADS_PER_SEGMENT, HAIR_TILE_CHUNK } from './rasterLimits.ts'
import type { HairSampleCount } from './visibilityMath.ts'

/** The threads a group gives a segment of a tile of `count`, as `hairThreadsPerSegment` picks them. */
const threadsText = `fn threadsPerSegment(count:u32)->u32{
 var threads=1u;
${HAIR_THREADS_PER_SEGMENT.map((t) => ` if(count<=${Math.floor(HAIR_TILE_CHUNK / t)}u){threads=${t}u;}`).join('\n')}
 return threads;
}`

/** The layout of the grid, the tiles and the lists the binned raster works over. */
const LAYOUT_TEXT = `const CHUNK=${HAIR_TILE_CHUNK}u;
// A tile is named by its rank plus one in the layers that point at it, zero meaning none.
const NO_TILE=0u;
fn cellCount()->u32{return tp.cells.x*tp.cells.y;}
// The grid: the furthest opaque depth of each cell, then four layers of counters for each binner (the segments counted, the segments written, the
// tile being filled, the tile before it), then each binner's list of the cells it allocates a tile in.
const COUNTED=0u;
const WRITTEN=1u;
const CURRENT=2u;
const PREVIOUS=3u;
fn counterAt(kind:u32,binner:u32,cell:u32)->u32{return cellCount()*(1u+kind*tp.binners+binner)+cell;}
fn allocationAt(binner:u32,i:u32)->u32{return cellCount()*(1u+4u*tp.binners)+binner*cellCount()+i;}
// A tile's words in the tileData buffer, after its count: where its segments start, how many it holds, its cell and the first count it takes.
const WORD_OFFSET=0u;
const WORD_COUNT=1u;
const WORD_CELL=2u;
const WORD_FIRST=3u;
fn tileWord(tile:u32,word:u32)->u32{return 4u+tile*4u+word;}
fn tileCount()->u32{return min(atomicLoad(&tileData[0]),tp.maxTiles);}
${threadsText}`

/** The depth of the opaque surfaces, the furthest of each cell: a segment nearer than it everywhere is behind. */
const DEPTH_GRID_TEXT = `var<workgroup> furthest:atomic<u32>;
@compute @workgroup_size(CHUNK) fn hairDepthGrid(@builtin(workgroup_id) cell:vec3u,@builtin(local_invocation_index) lane:u32){
 if(cell.x>=tp.cells.x||cell.y>=tp.cells.y){return;}
 // A cell out of the band's rows is left to the dispatch of its own band.
 if(((cell.y+1u)<<tp.shift)<=band.first||(cell.y<<tp.shift)>=band.end){return;}
 if(lane==0u){atomicStore(&furthest,0xffffffffu);}
 workgroupBarrier();
 for(var p=lane;p<tp.tileSize*tp.tileSize;p+=CHUNK){
  let pixel=vec2u((cell.x<<tp.shift)+(p&(tp.tileSize-1u)),(cell.y<<tp.shift)+(p>>tp.shift));
  if(pixel.x<tp.size.x&&pixel.y<tp.size.y){
   atomicMin(&furthest,bitcast<u32>(textureLoad(sceneDepth,vec2i(pixel),0)));
  }
 }
 workgroupBarrier();
 if(lane==0u){atomicStore(&grid[cell.y*tp.cells.x+cell.x],atomicLoad(&furthest));}
}`

/** The classification: a segment small enough for a tile goes to the software list, a larger one to the hardware list. */
const CLASSIFY_TEXT = `@compute @workgroup_size(CHUNK) fn hairClassify(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_index) lane:u32){
 let points=inst.ids.y;
 let batches=(points+CHUNK-1u)/CHUNK;
 let loops=(batches+tp.classifiers-1u)/tp.classifiers;
 for(var round=0u;round<loops;round++){
  let batch=round+block.x*loops;
  let segment=batch*CHUNK+lane;
  if(batch>=batches||segment>=points){continue;}
  let ribbon=ribbonOf(segment);
  if(!ribbon.ok){continue;}
  let box=ribbonBox(ribbon.corners);
  if(max(box.z-box.x,box.w-box.y)<=f32(tp.tileSize)){
   let slot=atomicAdd(&lists[LIST_SOFTWARE],1u);
   atomicStore(&lists[2u+slot],segment);
  }else{
   let slot=atomicAdd(&lists[LIST_HARDWARE],1u);
   atomicStore(&lists[1u+tp.listSize-slot],segment);
  }
 }
}`

/** The counters, the tile count and the lists emptied. */
const CLEAR_TEXT = `@compute @workgroup_size(CHUNK) fn hairTileClear(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let i=flatIndex(id,groups,CHUNK);
 if(i==0u){
  atomicStore(&tileData[0],0u);
  atomicStore(&tileData2[0],0u);
  atomicStore(&lists[LIST_SOFTWARE],0u);
  atomicStore(&lists[LIST_HARDWARE],0u);
 }
 if(i<cellCount()*4u*tp.binners){atomicStore(&grid[cellCount()+i],0u);}
}`

/** The binning of the ribbons into the tiles they reach. */
const BIN_TEXT = `override BIN_LISTED:u32=0u;
var<workgroup> vertexCount:u32;
var<workgroup> allocationCount:atomic<u32>;
// The cell of a tile of the segment: counted, or written to the tile its binner fills.
fn binTile(cell:u32,segment:u32,nearest:u32,binner:u32,phase:u32){
 // Behind every opaque pixel of the cell: nothing of it can show.
 if(nearest<atomicLoad(&grid[cell])){return;}
 if(phase==COUNTED){
  let old=atomicAdd(&grid[counterAt(COUNTED,binner,cell)],1u);
  // The count crosses into a new tile: the cell is listed to be given one.
  if(old%CHUNK==0u){
   let slot=atomicAdd(&allocationCount,1u);
   if(slot<cellCount()){atomicStore(&grid[allocationAt(binner,slot)],cell);}
  }
  return;
 }
 let total=atomicLoad(&grid[counterAt(COUNTED,binner,cell)]);
 let old=atomicAdd(&grid[counterAt(WRITTEN,binner,cell)],1u);
 // The segments counted before the one that crossed into the new tile fill the tile before it.
 let first=(total-1u)&~(CHUNK-1u);
 var destination=atomicLoad(&grid[counterAt(CURRENT,binner,cell)]);
 if(old<first){destination=atomicLoad(&grid[counterAt(PREVIOUS,binner,cell)]);}
 if(destination==NO_TILE){return;}
 let tile=destination-1u;
 prims[tile*CHUNK+(old&(CHUNK-1u))]=segment;
 // The last segment counted gives the tile its count.
 if(old+1u==total){atomicStore(&tileData[tileWord(tile,WORD_COUNT)],(old&(CHUNK-1u))+1u);}
}
// Every cell the ribbon's two triangles reach, row of cells after row: the cells of a row between the least and the greatest x the triangles
// span within it, so that the width of a ribbon is binned and not only its spine.
fn binRibbon(ribbon:Ribbon,segment:u32,nearest:u32,binner:u32,phase:u32){
 let box=ribbonBox(ribbon.corners);
 let size=vec2f(tp.size);
 if(box.z<0.0||box.w<0.0||box.x>=size.x||box.y>=size.y){return;}
 let ts=f32(tp.tileSize);
 let last=vec2f(tp.cells-vec2u(1u));
 let rowLo=max(u32(clamp(floor(box.y/ts),0.0,last.y)),band.first>>tp.shift);
 let rowHi=min(u32(clamp(floor(box.w/ts),0.0,last.y)),(band.end-1u)>>tp.shift);
 let c=ribbon.corners;
 let a0=c[cornerRank(0u)].xy/SUBPIXEL;
 let b0=c[cornerRank(1u)].xy/SUBPIXEL;
 let c0=c[cornerRank(2u)].xy/SUBPIXEL;
 let a1=c[cornerRank(3u)].xy/SUBPIXEL;
 let b1=c[cornerRank(4u)].xy/SUBPIXEL;
 let c1=c[cornerRank(5u)].xy/SUBPIXEL;
 for(var row=rowLo;row<=rowHi;row++){
  let y0=f32(row)*ts;
  let span0=rowSpan(a0,b0,c0,y0,y0+ts);
  let span1=rowSpan(a1,b1,c1,y0,y0+ts);
  let lo=min(span0.x,span1.x);
  let hi=max(span0.y,span1.y);
  if(lo>hi){continue;}
  let colLo=u32(clamp(floor(lo/ts),0.0,last.x));
  let colHi=u32(clamp(floor(hi/ts),0.0,last.x));
  for(var col=colLo;col<=colHi;col++){binTile(row*tp.cells.x+col,segment,nearest,binner,phase);}
 }
}
// One group a binner: the segments (every segment, or the software list) in batches of a group's threads; each batch is counted into the cells,
// the cells that cross into a new tile are given one, then the segments are written to their tiles.
@compute @workgroup_size(CHUNK) fn hairBin(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_index) lane:u32){
 let binner=block.x;
 if(lane==0u){
  vertexCount=inst.ids.y;
  if(BIN_LISTED!=0u){vertexCount=atomicLoad(&lists[LIST_SOFTWARE]);}
 }
 workgroupBarrier();
 let vertices=workgroupUniformLoad(&vertexCount);
 let batches=(vertices+CHUNK-1u)/CHUNK;
 let loops=(batches+tp.binners-1u)/tp.binners;
 for(var round=0u;round<loops;round++){
  let batch=round+binner*loops;
  let index=batch*CHUNK+lane;
  var segment=index;
  var ribbon:Ribbon;
  var nearest=0u;
  if(batch<batches&&index<vertices){
   if(BIN_LISTED!=0u){segment=listedSegment(LIST_SOFTWARE,index);}
   ribbon=ribbonOf(segment);
   let c=ribbon.corners;
   nearest=bitcast<u32>(saturate(max(max(c[0].z,c[1].z),max(c[2].z,c[3].z))));
  }
  if(lane==0u){atomicStore(&allocationCount,0u);}
  workgroupBarrier();
  if(ribbon.ok){binRibbon(ribbon,segment,nearest,binner,COUNTED);}
  workgroupBarrier();
  let allocated=min(atomicLoad(&allocationCount),cellCount());
  for(var i=lane;i<allocated;i+=CHUNK){
   let cell=atomicLoad(&grid[allocationAt(binner,i)]);
   let total=atomicLoad(&grid[counterAt(COUNTED,binner,cell)]);
   let before=atomicLoad(&grid[counterAt(WRITTEN,binner,cell)]);
   let previous=atomicLoad(&grid[counterAt(CURRENT,binner,cell)]);
   let tile=atomicAdd(&tileData[0],1u);
   var current=NO_TILE;
   // A tile past the room is not made: the segments bound for it are dropped.
   if(tile<tp.maxTiles){
    atomicStore(&tileData[tileWord(tile,WORD_OFFSET)],tile*CHUNK);
    atomicStore(&tileData[tileWord(tile,WORD_COUNT)],0u);
    atomicStore(&tileData[tileWord(tile,WORD_CELL)],(cell%tp.cells.x)|((cell/tp.cells.x)<<16u));
    atomicStore(&tileData[tileWord(tile,WORD_FIRST)],(total-1u)&~(CHUNK-1u));
    current=tile+1u;
   }
   // The tile before it is full.
   if(before>0u&&previous!=NO_TILE){atomicStore(&tileData[tileWord(previous-1u,WORD_COUNT)],CHUNK);}
   atomicStore(&grid[counterAt(PREVIOUS,binner,cell)],previous);
   atomicStore(&grid[counterAt(CURRENT,binner,cell)],current);
  }
  workgroupBarrier();
  if(ribbon.ok){binRibbon(ribbon,segment,nearest,binner,WRITTEN);}
 }
}`

/** The compaction of the tiles of a cell into full ones. */
const COMPACT_TEXT = `var<workgroup> cellTotal:atomic<u32>;
var<workgroup> sharedTotal:u32;
var<workgroup> sharedTiles:u32;
var<workgroup> sharedFirst:u32;
var<workgroup> windowCount:atomic<u32>;
var<workgroup> sharedWindow:u32;
var<workgroup> window:array<u32,CHUNK>;
// One group a cell: the segments of all the tiles the binners made in it are copied to full tiles, and the tile count of the compacted set grows by them.
@compute @workgroup_size(CHUNK) fn hairTileCompact(@builtin(workgroup_id) cell:vec3u,@builtin(local_invocation_index) lane:u32){
 let packed=cell.x|(cell.y<<16u);
 if(lane==0u){
  atomicStore(&cellTotal,0u);
  sharedTiles=tileCount();
 }
 workgroupBarrier();
 let tiles=workgroupUniformLoad(&sharedTiles);
 var mine=0u;
 for(var t=lane;t<tiles;t+=CHUNK){
  if(atomicLoad(&tileData[tileWord(t,WORD_CELL)])==packed){mine+=atomicLoad(&tileData[tileWord(t,WORD_COUNT)]);}
 }
 if(mine>0u){atomicAdd(&cellTotal,mine);}
 workgroupBarrier();
 if(lane==0u){
  sharedTotal=atomicLoad(&cellTotal);
  let made=(sharedTotal+CHUNK-1u)/CHUNK;
  sharedFirst=atomicAdd(&tileData2[0],made);
  for(var i=0u;i<made;i++){
   let tile=sharedFirst+i;
   if(tile<tp.maxTiles){
    atomicStore(&tileData2[tileWord(tile,WORD_OFFSET)],tile*CHUNK);
    atomicStore(&tileData2[tileWord(tile,WORD_COUNT)],min(sharedTotal-i*CHUNK,CHUNK));
    atomicStore(&tileData2[tileWord(tile,WORD_CELL)],packed);
    atomicStore(&tileData2[tileWord(tile,WORD_FIRST)],0u);
   }
  }
 }
 workgroupBarrier();
 let total=workgroupUniformLoad(&sharedTotal);
 if(total==0u){return;}
 let first=workgroupUniformLoad(&sharedFirst);
 var written=0u;
 // The tiles of the cell, a window of the tile list at a time, so that no cell has more tiles than the window holds.
 for(var start=0u;start<tiles;start+=CHUNK){
  if(lane==0u){atomicStore(&windowCount,0u);}
  workgroupBarrier();
  let t=start+lane;
  if(t<tiles&&atomicLoad(&tileData[tileWord(t,WORD_CELL)])==packed){window[atomicAdd(&windowCount,1u)]=t;}
  workgroupBarrier();
  if(lane==0u){sharedWindow=atomicLoad(&windowCount);}
  workgroupBarrier();
  let listed=workgroupUniformLoad(&sharedWindow);
  for(var w=0u;w<listed;w++){
   let source=window[w];
   let count=atomicLoad(&tileData[tileWord(source,WORD_COUNT)]);
   let to=first*CHUNK+written+lane;
   if(lane<count&&to<tp.maxTiles*CHUNK){prims2[to]=prims[source*CHUNK+lane];}
   written+=count;
  }
  workgroupBarrier();
 }
}`

/** The raster of the tiles: one group walks a share of the tiles, a thread a segment of a tile (or a share of the pixels of a segment). */
const TILE_RASTER_TEXT = `@compute @workgroup_size(CHUNK) fn hairTileRaster(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_index) lane:u32){
 let tiles=tileCount();
 let loops=(tiles+tp.rasterizers-1u)/tp.rasterizers;
 for(var round=0u;round<loops;round++){
  let tile=round+block.x*loops;
  if(tile>=tiles){return;}
  let count=atomicLoad(&tileData[tileWord(tile,WORD_COUNT)]);
  let cell=atomicLoad(&tileData[tileWord(tile,WORD_CELL)]);
  let share=threadsPerSegment(count);
  if(lane>=count*share){continue;}
  let prim=lane/share;
  let ribbon=ribbonOf(prims[tile*CHUNK+prim]);
  if(!ribbon.ok){continue;}
  // The window of the tile, in the band's rows: the pixels one tile's threads write are theirs alone.
  let origin=vec2u(cell&0xffffu,cell>>16u)<<vec2u(tp.shift);
  clipBox=vec4u(origin.x,max(origin.y,band.first),min(origin.x+tp.tileSize,tp.size.x),min(origin.y+tp.tileSize,band.end));
  drawRibbon(ribbon,vec2u(lane-prim*share,0u),vec2u(share,1u));
 }
}`

/** The module of the compute raster's tiles: the entries that classify the segments, bin them, compact the tiles, and draw them. */
export function binnedWgsl(samples: HairSampleCount, wide: boolean) {
  return rasterModule(
    samples,
    wide,
    [
      LAYOUT_TEXT,
      DEPTH_GRID_TEXT,
      CLASSIFY_TEXT,
      CLEAR_TEXT,
      BIN_TEXT,
      COMPACT_TEXT,
      TILE_RASTER_TEXT,
    ].join('\n'),
  )
}
