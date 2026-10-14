/** The load-balanced entry point: one thread per (item, instance of the item), in rows, and its
 *  group 1: 0 params (uniform), 1 instances, 2 items. */
export const VSM_STALE_BOXES_WGSL = /* wgsl */ `
struct VsmInvalidationParams{invItemCount:u32,boxCount:u32,pad:vec2u,}
struct VsmInvalidationItem{firstBox:u32,boxCount:u32,payload:u32,prefix:u32,}
@group(1) @binding(0) var<uniform> vsmInv:VsmInvalidationParams;
@group(1) @binding(1) var<storage,read> vsmInvInstances:array<VsmInvalidationInstance>;
@group(1) @binding(2) var<storage,read> vsmInvItems:array<VsmInvalidationItem>;
@compute @workgroup_size(WORKGROUP_THREADS)
fn vsmStaleBoxes(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lidx:u32){
 let thread=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lidx;
 if(thread>=vsmInv.boxCount||vsmInv.invItemCount==0u){return;}
 // Item of this thread: the last whose prefix is <= thread.
 var lo=0u;
 var hi=vsmInv.invItemCount-1u;
 while(lo<hi){
  let mid=(lo+hi+1u)>>1u;
  if(vsmInvItems[mid].prefix<=thread){lo=mid;}else{hi=mid-1u;}
 }
 let item=vsmInvItems[lo];
 let indexInItem=thread-item.prefix;
 if(indexInItem>=item.boxCount){return;}
 let boxIndex=item.firstBox+indexInItem;
 if(boxIndex>=arrayLength(&vsmInvInstances)){return;}
 let inst=vsmInvInstances[boxIndex];
 // A valid instance that casts shadows.
 if((inst.flags&VSM_BOX_CASTS)==0u){return;}
 let mapId=vsmStaleMap(item.payload,(inst.flags&VSM_BOX_MOVING)!=0u);
 if(mapId>=arrayLength(&vsmProjectionData)){return;}
 let pd=vsmProjectionOf(vsmHandleFromId(mapId));
 vsmStaleBoxPages(pd,inst);
}
`
