//! Region simplification for the cluster DAG.
use std::collections::HashMap;
use crate::{invalid,Result};
use meshopt::{SimplifyOptions,VertexDataAdapter};
pub struct SimplifiedMesh { pub indices:Vec<u32>, pub error_object:f64, pub triangles:usize }
/// Region-local vertex buffer plus the table that maps a local index back to its source index.
/// The dense table is used whenever it is not much larger than the index list; a hash map covers
/// the case of a small region inside a very large vertex buffer.
pub(crate) fn compact_region(positions:&[f32],indices:&[u32])->(Vec<f32>,Vec<u32>,Vec<u32>){
 let vertex_count=positions.len()/3;
 let mut compact_pos=Vec::new();let mut remap=Vec::new();
 let mut compact_idx=Vec::with_capacity(indices.len());
 let push=|source:u32,compact_pos:&mut Vec<f32>,remap:&mut Vec<u32>|{
  let i=source as usize*3;
  if i+2<positions.len(){compact_pos.extend_from_slice(&positions[i..i+3]);}else{compact_pos.extend_from_slice(&[0.0,0.0,0.0]);}
  remap.push(source);
 };
 if indices.len()*4>=vertex_count{
  let mut table=vec![u32::MAX;vertex_count];
  for &source in indices{
   let slot=table.get_mut(source as usize);
   let id=match slot{
    Some(entry) if *entry!=u32::MAX=>*entry,
    Some(entry)=>{let id=remap.len() as u32;*entry=id;push(source,&mut compact_pos,&mut remap);id}
    None=>{let id=remap.len() as u32;push(source,&mut compact_pos,&mut remap);id}
   };
   compact_idx.push(id);
  }
 }else{
  let mut map=HashMap::with_capacity(indices.len());
  for &source in indices{
   let id=match map.get(&source){
    Some(&id)=>id,
    None=>{let id=remap.len() as u32;map.insert(source,id);push(source,&mut compact_pos,&mut remap);id}
   };
   compact_idx.push(id);
  }
 }
 (compact_pos,compact_idx,remap)
}
/// Simplify a region with an explicit per-vertex lock table instead of a blanket border lock.
/// `locked` is queried with source vertex indices. A vertex that no other region shares stays free,
/// so the open boundary of a primitive keeps simplifying instead of pinning the whole region.
pub fn simplify_with_locked_vertices(positions:&[f32],indices:&[u32],target_triangles:usize,target_error:f32,locked:&dyn Fn(u32)->bool)->Result<SimplifiedMesh>{
 if indices.len()<3||indices.len()%3!=0{return Err(invalid("Index count must be a positive multiple of three"));}
 if positions.len()%3!=0{return Err(invalid("POSITION count must be a multiple of three"));}
 let current=indices.len()/3;
 if current<=target_triangles.max(1){return Ok(SimplifiedMesh{indices:indices.to_vec(),error_object:0.0,triangles:current});}
 let (compact_pos,compact_idx,remap)=compact_region(positions,indices);
 let locks:Vec<bool>=remap.iter().map(|&source|locked(source)).collect();
 let bytes=unsafe{std::slice::from_raw_parts(compact_pos.as_ptr() as *const u8,compact_pos.len()*4)};
 let vertices=VertexDataAdapter::new(bytes,12,0).map_err(|_|invalid("POSITION adapter"))?;
 let mut result_error=0.0_f32;
 let out=meshopt::simplify::simplify_with_locks(&compact_idx,&vertices,&locks,(target_triangles.max(1))*3,target_error,SimplifyOptions::None,Some(&mut result_error));
 let triangles=out.len()/3;
 let progressed=triangles<current&&!out.is_empty();
 let scale=meshopt::simplify::simplify_scale(&vertices) as f64;
 let mapped=if progressed{out.into_iter().map(|i|remap.get(i as usize).copied().unwrap_or(i)).collect()}else{indices.to_vec()};
 Ok(SimplifiedMesh{indices:mapped,triangles:if progressed{triangles}else{current},error_object:if progressed{(result_error as f64)*scale}else{0.0}})
}
#[cfg(test)] mod tests{
 use super::*;
 const CUBE_POSITIONS:[f32;24]=[0.,0.,0.,1.,0.,0.,1.,1.,0.,0.,1.,0.,0.,0.,1.,1.,0.,1.,1.,1.,1.,0.,1.,1.];
 const CUBE_INDICES:[u32;36]=[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4];
 #[test] fn free_vertices_reduce_a_closed_cube(){
  let reduced=simplify_with_locked_vertices(&CUBE_POSITIONS,&CUBE_INDICES,6,1.0,&|_|false).expect("cube");
  assert!(reduced.triangles<12,"expected a reduction, got {}",reduced.triangles);
  assert!(reduced.error_object>=0.0&&reduced.error_object.is_finite());
  assert_eq!(reduced.indices.len(),reduced.triangles*3);
  assert!(reduced.indices.iter().all(|&id|(id as usize)<CUBE_POSITIONS.len()/3),"indices stay in the source buffer");
 }
 #[test] fn locked_vertices_keep_every_triangle(){
  let kept=simplify_with_locked_vertices(&CUBE_POSITIONS,&CUBE_INDICES,6,1.0,&|_|true).expect("cube");
  assert_eq!(kept.triangles,12);
  assert_eq!(kept.indices,CUBE_INDICES.to_vec());
  assert_eq!(kept.error_object,0.0);
 }
 #[test] fn a_mesh_already_below_the_target_is_returned_untouched(){
  let open=simplify_with_locked_vertices(&[0.,0.,0.,1.,0.,0.,0.,1.,0.],&[0u32,1,2],0,1.0,&|_|false).expect("triangle");
  assert_eq!(open.indices,vec![0,1,2]);
  assert_eq!(open.triangles,1);
 }
 #[test] fn malformed_input_is_rejected(){
  assert!(simplify_with_locked_vertices(&CUBE_POSITIONS,&[0u32,1],1,1.0,&|_|false).is_err());
  assert!(simplify_with_locked_vertices(&[0.,0.],&CUBE_INDICES,1,1.0,&|_|false).is_err());
 }
 #[test] fn compact_region_renumbers_each_vertex_once_and_maps_back(){
  for positions in [CUBE_POSITIONS.to_vec(),{let mut wide=CUBE_POSITIONS.to_vec();wide.extend(std::iter::repeat(0.0).take(3*4096));wide}]{
   let (compact_pos,compact_idx,remap)=compact_region(&positions,&CUBE_INDICES);
   assert_eq!(compact_pos.len(),remap.len()*3);
   assert_eq!(compact_idx.len(),CUBE_INDICES.len());
   assert_eq!(remap.len(),8);
   for (local,&source) in compact_idx.iter().zip(CUBE_INDICES.iter()){assert_eq!(remap[*local as usize],source);}
  }
 }
}
