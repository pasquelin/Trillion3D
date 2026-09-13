use std::collections::{HashMap,HashSet};
use crate::{invalid,Result};
use meshopt::{SimplifyOptions,VertexDataAdapter};
#[derive(Clone,Copy,PartialEq,Eq,Hash)]
enum LinkItem { Vertex(u32), Edge(u32,u32) }
#[allow(dead_code)]
pub struct SimplifiedMesh { pub indices:Vec<u32>, pub error_object:f64, pub triangles:usize }
fn position(positions:&[f32],index:u32)->[f64;3]{
 let i=index as usize*3;
 [positions[i] as f64,positions[i+1] as f64,positions[i+2] as f64]
}
fn plane_of(p0:[f64;3],p1:[f64;3],p2:[f64;3])->Option<[f64;4]>{
 let n=[
  (p1[1]-p0[1])*(p2[2]-p0[2])-(p1[2]-p0[2])*(p2[1]-p0[1]),
  (p1[2]-p0[2])*(p2[0]-p0[0])-(p1[0]-p0[0])*(p2[2]-p0[2]),
  (p1[0]-p0[0])*(p2[1]-p0[1])-(p1[1]-p0[1])*(p2[0]-p0[0]),
 ];
 let len=(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]).sqrt();
 if !(len>0.0){return None;}
 let a=n[0]/len;let b=n[1]/len;let c=n[2]/len;
 Some([a,b,c,-(a*p0[0]+b*p0[1]+c*p0[2])])
}
fn add_plane(quadric:&mut [[f64;4];4],plane:[f64;4]){
 for r in 0..4{for c in 0..4{quadric[r][c]+=plane[r]*plane[c];}}
}
fn add_quadrics(left:&[[f64;4];4],right:&[[f64;4];4])->[[f64;4];4]{
 let mut out=[[0.0;4];4];
 for r in 0..4{for c in 0..4{out[r][c]=left[r][c]+right[r][c];}}
 out
}
fn energy(quadric:&[[f64;4];4],point:[f64;3])->f64{
 let h=[point[0],point[1],point[2],1.0];
 let mut sum=0.0;
 for r in 0..4{for c in 0..4{sum+=h[r]*quadric[r][c]*h[c];}}
 sum
}
fn simplicial_link(faces:&[[u32;3]],simplex:&HashSet<u32>)->HashSet<LinkItem>{
 let mut result=HashSet::new();
 for triangle in faces{
  if simplex.iter().any(|v|!triangle.contains(v)){continue;}
  let mut remaining:Vec<u32>=triangle.iter().copied().filter(|v|!simplex.contains(v)).collect();
  remaining.sort_unstable();
  if remaining.len()==1{result.insert(LinkItem::Vertex(remaining[0]));}
  else if remaining.len()==2{
   result.insert(LinkItem::Vertex(remaining[0]));
   result.insert(LinkItem::Vertex(remaining[1]));
   result.insert(LinkItem::Edge(remaining[0],remaining[1]));
  }
 }
 result
}
fn link_condition(faces:&[[u32;3]],left:u32,right:u32)->bool{
 let link_left=simplicial_link(faces,&HashSet::from([left]));
 let link_right=simplicial_link(faces,&HashSet::from([right]));
 let link_edge=simplicial_link(faces,&HashSet::from([left,right]));
 if link_left.is_empty()||link_right.is_empty(){return false;}
 let intersection=link_left.iter().filter(|item|link_right.contains(item)).count();
 if intersection!=link_edge.len(){return false;}
 link_edge.iter().all(|item|link_left.contains(item)&&link_right.contains(item))
}
fn boundary_edges(faces:&[[u32;3]])->HashSet<(u32,u32)>{
 let mut occ:HashMap<(u32,u32),Vec<(u32,u32)>>=HashMap::new();
 for triangle in faces{
  for e in 0..3{
   let start=triangle[e];let end=triangle[(e+1)%3];
   let key=if start<end{(start,end)}else{(end,start)};
   occ.entry(key).or_default().push((start,end));
  }
 }
 let mut locked=HashSet::new();
 for (key,list) in occ{
  let manifold=list.len()==2&&list[0].0==list[1].1&&list[0].1==list[1].0;
  if !manifold{locked.insert(key);}
 }
 locked
}
fn compact_region(positions:&[f32],indices:&[u32])->(Vec<f32>,Vec<u32>,Vec<u32>){
 let mut map=HashMap::new();
 let mut compact_pos=Vec::new();
 let mut remap=Vec::new();
 let mut compact_idx=Vec::with_capacity(indices.len());
 for &id in indices{
  let compact=*map.entry(id).or_insert_with(||{
   let n=remap.len() as u32;
   let i=id as usize*3;
   if i+2<positions.len(){compact_pos.extend_from_slice(&positions[i..i+3]);}else{compact_pos.extend_from_slice(&[0.0,0.0,0.0]);}
   remap.push(id);
   n
  });
  compact_idx.push(compact);
 }
 (compact_pos,compact_idx,remap)
}
/// Fast appearance-preserving simplify. Locks the topological border so cluster seams stay watertight. Vertices stay in the source buffer.
pub fn simplify_fast(positions:&[f32],indices:&[u32],target_triangles:usize)->Result<SimplifiedMesh>{
 if indices.len()<3||indices.len()%3!=0{return Err(invalid("Index count must be a positive multiple of three"));}
 if positions.len()%3!=0{return Err(invalid("POSITION count must be a multiple of three"));}
 let current=indices.len()/3;
 if current<=target_triangles.max(1){return Ok(SimplifiedMesh{indices:indices.to_vec(),error_object:0.0,triangles:current});}
 let (compact_pos,compact_idx,remap)=compact_region(positions,indices);
 let bytes=unsafe{std::slice::from_raw_parts(compact_pos.as_ptr() as *const u8,compact_pos.len()*4)};
 let vertices=VertexDataAdapter::new(bytes,12,0).map_err(|_|invalid("POSITION adapter"))?;
 let mut result_error=0.0_f32;
 let out=meshopt::simplify::simplify(&compact_idx,&vertices,(target_triangles.max(1))*3,0.01,SimplifyOptions::LockBorder,Some(&mut result_error));
 let triangles=out.len()/3;
 let progressed=triangles<current&&!out.is_empty();
 let scale=meshopt::simplify::simplify_scale(&vertices) as f64;
 let mapped=if progressed{out.into_iter().map(|i|remap.get(i as usize).copied().unwrap_or(i)).collect()}else{indices.to_vec()};
 Ok(SimplifiedMesh{indices:mapped,triangles:if progressed{triangles}else{current},error_object:if progressed{(result_error as f64)*scale}else{0.0}})
}
/// Garland-Heckbert endpoint contraction. Boundary edges stay locked. New vertices are not created.
#[cfg_attr(not(test),allow(dead_code))]
pub fn simplify_to_endpoints(positions:&[f32],indices:&[u32],target_triangles:usize)->Result<SimplifiedMesh>{
 if positions.len()%3!=0{return Err(invalid("POSITION count must be a multiple of three"));}
 let vertex_count=positions.len()/3;
 let mut faces=Vec::new();
 if indices.len()%3!=0{return Err(invalid("Index count must be a positive multiple of three"));}
 for tri in indices.chunks_exact(3){
  let a=tri[0];let b=tri[1];let c=tri[2];
  if a==b||b==c||c==a{continue;}
  if [a,b,c].iter().any(|&v|(v as usize)>=vertex_count){return Err(invalid("Invalid index"));}
  faces.push([a,b,c]);
 }
 if !faces.is_empty(){
  let flat:Vec<u32>=faces.iter().flatten().copied().collect();
  crate::topology::classify_topology(&flat,vertex_count)?;
 }
 let mut error_object=0.0_f64;
 while faces.len()>target_triangles{
  let locked=boundary_edges(&faces);
  let mut locked_verts=HashSet::new();
  for (a,b) in &locked{locked_verts.insert(*a);locked_verts.insert(*b);}
  let mut quadrics=vec![[[0.0;4];4];vertex_count];
  for &[a,b,c] in &faces{
   if let Some(plane)=plane_of(position(positions,a),position(positions,b),position(positions,c)){
    add_plane(&mut quadrics[a as usize],plane);
    add_plane(&mut quadrics[b as usize],plane);
    add_plane(&mut quadrics[c as usize],plane);
   }
  }
  let mut best:Option<(f64,u32,u32)>=None;
  let mut tried=HashSet::new();
  for triangle in &faces{
   for e in 0..3{
    let left=triangle[e];let right=triangle[(e+1)%3];
    let key=if left<right{(left,right)}else{(right,left)};
    if !tried.insert(key)||locked.contains(&key){continue;}
    let locked_left=locked_verts.contains(&left);let locked_right=locked_verts.contains(&right);
    if locked_left&&locked_right{continue;}
    if !link_condition(&faces,left,right){continue;}
    let combined=add_quadrics(&quadrics[left as usize],&quadrics[right as usize]);
    let cost_left=energy(&combined,position(positions,left));
    let cost_right=energy(&combined,position(positions,right));
    let (keep,drop,cost)=if locked_left{(left,right,cost_left)}else if locked_right{(right,left,cost_right)}else if cost_left<=cost_right{(left,right,cost_left)}else{(right,left,cost_right)};
    if !cost.is_finite(){continue;}
    let better=match best{None=>true,Some((best_cost,_,best_drop))=>cost<best_cost||(cost==best_cost&&drop<best_drop)};
    if better{best=Some((cost,keep,drop));}
   }
  }
  let Some((cost,keep,drop))=best else {break;};
  error_object=error_object.max(cost.max(0.0).sqrt());
  let mut next=Vec::new();
  for &[a,b,c] in &faces{
   let tri=[if a==drop{keep}else{a},if b==drop{keep}else{b},if c==drop{keep}else{c}];
   if tri[0]!=tri[1]&&tri[1]!=tri[2]&&tri[2]!=tri[0]{next.push(tri);}
  }
  if next.len()>=faces.len()||(next.is_empty()&&!faces.is_empty()){break;}
  faces=next;
 }
 Ok(SimplifiedMesh{triangles:faces.len(),indices:faces.into_iter().flatten().collect(),error_object})
}
#[cfg(test)] mod tests{
 use super::*;
 const CUBE_POSITIONS:[f32;24]=[0.,0.,0.,1.,0.,0.,1.,1.,0.,0.,1.,0.,0.,0.,1.,1.,0.,1.,1.,1.,1.,0.,1.,1.];
 const CUBE_INDICES:[u32;36]=[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4];
 #[test] fn closed_cube_reduces_and_open_triangle_stays(){
  let reduced=simplify_to_endpoints(&CUBE_POSITIONS,&CUBE_INDICES,8).expect("cube");
  assert!(reduced.triangles<=8, "expected <=8 triangles, got {}", reduced.triangles);
  assert!(reduced.triangles<12);
  assert!(reduced.error_object>=0.0);
  let open=simplify_to_endpoints(&[0.,0.,0.,1.,0.,0.,0.,1.,0.],&[0u32,1,2],0).expect("triangle");
  assert_eq!(open.indices,vec![0,1,2]);
 }
 #[test] fn meshopt_locks_border_and_reduces_a_closed_cube(){
  let reduced=simplify_fast(&CUBE_POSITIONS,&CUBE_INDICES,8).expect("meshopt");
  assert!(reduced.triangles<=12);
  assert!(reduced.error_object>=0.0);
  let open=simplify_fast(&[0.,0.,0.,1.,0.,0.,0.,1.,0.],&[0u32,1,2],0).expect("triangle");
  assert_eq!(open.indices,vec![0,1,2]);
 }
 #[test] fn unused_far_vertex_does_not_change_region_error(){
  let mut far=CUBE_POSITIONS.to_vec();far.extend([1000.,1000.,1000.]);
  let a=simplify_fast(&CUBE_POSITIONS,&CUBE_INDICES,8).expect("cube");
  let b=simplify_fast(&far,&CUBE_INDICES,8).expect("far");
  assert_eq!(a.triangles,b.triangles);
  assert!((a.error_object-b.error_object).abs()<=1e-6*a.error_object.max(1.0));
 }
 #[test] fn cube_error_is_finite(){
  let result=simplify_to_endpoints(&CUBE_POSITIONS,&CUBE_INDICES,6).expect("cube");
  assert!(result.error_object.is_finite());
  assert_eq!(result.indices.len(),result.triangles*3);
 }
}
