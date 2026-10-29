import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { AVSM_WGSL } from './avsmWgsl.ts'

/**
 * THE EDIT OF A TEXEL'S LINKED LIST, the ways a sample is added to the run of `maxCount` entries that starts at entry `pixel` of the
 * host's list (a read-write storage array of two-word entries, `avsmList`): appended while there is room, else, by the error of the
 * polyline the samples make, the one whose removal changes it least is replaced; without compression the last entry is overwritten. The
 * host is the shadow map's render and combine passes. `prev` is the last entry added, `next` the entry the next sample takes.
 */
export const AVSM_LIST_EDIT_WGSL = wgslBlock(
  'AVSM_LIST_EDIT_WGSL',
  [AVSM_WGSL],
  `
/** The entry whose removal marks the least geometric error: the area of the triangle it makes with its two neighbours. */
fn avsmLowestErrorIndex(pixel:i32,maxCount:i32)->i32{
 var lowestIndex=0;
 var lowest=1.0e6;
 for(var index=1;index<maxCount-1;index++){
  let entry=avsmList[pixel+index];
  let before=avsmListSample(avsmList[pixel+i32(avsmListPrev(entry))]);
  let here=avsmListSample(entry);
  let after=avsmListSample(avsmList[pixel+i32(avsmListNext(entry))]);
  let error=abs((after.x-before.x)*(after.tau-here.tau)-(after.x-here.x)*(after.tau-before.tau));
  if(error<lowest){lowest=error;lowestIndex=index;}
 }
 return lowestIndex;
}
fn avsmAddSample(s:AvsmSample,pixel:i32,prev:ptr<function,i32>,next:ptr<function,i32>){
 var entry=avsmListSetSample(vec2u(0u),s);
 entry=avsmListSetPrev(entry,u32(*prev));
 entry=avsmListSetNext(entry,u32(*next+1));
 avsmList[pixel+*next]=entry;
 *prev=*next;
 *next=*next+1;
}
/** Takes the entry out of its neighbours' links and puts the sample in its place between the entries named. */
fn avsmReplaceSample(pixel:i32,index:i32,s:AvsmSample,prevLink:i32,nextLink:i32){
 let old=avsmList[pixel+index];
 let before=i32(avsmListPrev(old));
 let after=i32(avsmListNext(old));
 avsmList[pixel+before]=avsmListSetNext(avsmList[pixel+before],u32(after));
 avsmList[pixel+after]=avsmListSetPrev(avsmList[pixel+after],u32(before));
 var entry=avsmListSetSample(old,s);
 entry=avsmListSetPrev(entry,u32(prevLink));
 entry=avsmListSetNext(entry,u32(nextLink));
 avsmList[pixel+index]=entry;
 avsmList[pixel+prevLink]=avsmListSetNext(avsmList[pixel+prevLink],u32(index));
 avsmList[pixel+nextLink]=avsmListSetPrev(avsmList[pixel+nextLink],u32(index));
}
fn avsmAddOrReplaceSample(s:AvsmSample,pixel:i32,maxCount:i32,compress:bool,prev:ptr<function,i32>,next:ptr<function,i32>){
 if(*next<maxCount-1){
  avsmAddSample(s,pixel,prev,next);
  return;
 }
 let last=pixel+maxCount-1;
 if(compress){
  // A fictitious sample at the last entry gives the error of the one before it.
  avsmList[last]=avsmListSetPrev(avsmListSetSample(avsmList[last],s),u32(*prev));
  avsmList[pixel+*prev]=avsmListSetNext(avsmList[pixel+*prev],u32(maxCount-1));
  let lowest=avsmLowestErrorIndex(pixel,maxCount);
  if(lowest>0){
   if(lowest==*prev){
    avsmList[pixel+*prev]=avsmListSetSample(avsmList[pixel+*prev],s);
   }else{
    avsmReplaceSample(pixel,lowest,s,*prev,maxCount-1);
   }
   *prev=lowest;
  }
 }else{
  avsmList[last]=avsmListSetPrev(avsmListSetSample(avsmList[last],s),u32(*prev));
  *prev=maxCount-1;
 }
}`,
)
