use crate::{invalid,Result};
#[derive(Debug,Clone,PartialEq)]
pub struct TopologyReport {
 pub triangles:usize,
 pub boundary_edges:usize,
 pub manifold_edges:usize,
 pub non_manifold_edges:usize,
 pub interior_vertices:usize,
 pub boundary_vertices:usize,
 pub locked_vertices:usize,
 pub unused_vertices:usize,
 pub manifold:bool,
 pub neighbors:Vec<Vec<usize>>,
}
fn edge_key(a:u32,b:u32)->(u32,u32){if a<b{(a,b)}else{(b,a)}}
/// Vertex class from its link: the edges of the faces around it, as (end, opposite) pairs.
///
/// A manifold interior vertex has a closed link, a boundary vertex an open one; anything else is
/// locked. Degrees never exceed two in either case, so the link is walked in place instead of being
/// materialised as a map per vertex.
fn classify_link(links:&[(u32,u32)])->&'static str{
 let mut ids:Vec<u32>=Vec::new();
 let mut neighbours:Vec<[u32;2]>=Vec::new();
 let mut degree:Vec<u8>=Vec::new();
 let mut slot=|ids:&mut Vec<u32>,neighbours:&mut Vec<[u32;2]>,degree:&mut Vec<u8>,vertex:u32|->usize{
  match ids.iter().position(|&id|id==vertex){
   Some(index)=>index,
   None=>{ids.push(vertex);neighbours.push([u32::MAX;2]);degree.push(0);ids.len()-1}
  }
 };
 for &(a,b) in links{
  if a==b{continue;}
  for (from,to) in [(a,b),(b,a)]{
   let index=slot(&mut ids,&mut neighbours,&mut degree,from);
   let held=degree[index] as usize;
   if (held>=1&&neighbours[index][0]==to)||(held>=2&&neighbours[index][1]==to){continue;}
   if held>=2{return "locked";}
   neighbours[index][held]=to;degree[index]=(held+1) as u8;
  }
 }
 if ids.is_empty(){return "locked";}
 let mut degree_one=0;let mut degree_two=0;
 for &held in &degree{match held{1=>degree_one+=1,2=>degree_two+=1,_=>return "locked"}}
 let mut seen=vec![false;ids.len()];
 let mut components=0;let mut stack=Vec::new();
 for start in 0..ids.len(){
  if seen[start]{continue;}
  components+=1;
  if components>1{return "locked";}
  stack.push(start);
  while let Some(node)=stack.pop(){
   if seen[node]{continue;}
   seen[node]=true;
   for k in 0..degree[node] as usize{
    let neighbour=neighbours[node][k];
    if let Some(index)=ids.iter().position(|&id|id==neighbour){if !seen[index]{stack.push(index);}}
   }
  }
 }
 if degree_one==0&&degree_two==ids.len(){"interior"}else if degree_one==2&&degree_two==ids.len()-2{"boundary"}else{"locked"}
}
pub fn classify_topology(indices:&[u32],vertex_count:usize)->Result<TopologyReport>{classify(indices,vertex_count,true)}
/// Same report without the triangle adjacency, which the cluster DAG does not use. Building it
/// means one vector per triangle, so skipping it saves both the allocations and their memory.
pub fn classify_topology_without_neighbors(indices:&[u32],vertex_count:usize)->Result<TopologyReport>{classify(indices,vertex_count,false)}
fn classify(indices:&[u32],vertex_count:usize,want_neighbors:bool)->Result<TopologyReport>{
 if indices.len()%3!=0||indices.is_empty(){return Err(invalid("Index count must be a positive multiple of three"));}
 let triangle_count=indices.len()/3;
 let mut halves=Vec::with_capacity(triangle_count*3);
 let mut incident=vec![0u32;vertex_count];
 let mut link_count=vec![0u32;vertex_count];
 for face in 0..triangle_count{
  let tri=[indices[face*3],indices[face*3+1],indices[face*3+2]];
  for vertex in tri{if vertex as usize>=vertex_count{return Err(invalid("Invalid index"));}}
  for e in 0..3{
   let start=tri[e];let end=tri[(e+1)%3];let other=tri[(e+2)%3];
   let key=edge_key(start,end);
   halves.push((key.0,key.1,start,end,face));
   incident[start as usize]+=1;
   if start!=end{link_count[start as usize]+=1;}
   let _=other;
  }
 }
 // Compressed links: one flat array with a per-vertex offset, instead of a vector per vertex.
 let mut offsets=vec![0u32;vertex_count+1];
 for vertex in 0..vertex_count{offsets[vertex+1]=offsets[vertex]+link_count[vertex];}
 let mut cursor=offsets.clone();
 let mut links=vec![(0u32,0u32);offsets[vertex_count] as usize];
 for face in 0..triangle_count{
  let tri=[indices[face*3],indices[face*3+1],indices[face*3+2]];
  for e in 0..3{
   let start=tri[e];let end=tri[(e+1)%3];let other=tri[(e+2)%3];
   if start==end{continue;}
   let at=&mut cursor[start as usize];
   links[*at as usize]=(end,other);*at+=1;
  }
 }
 halves.sort_unstable_by(|left,right|left.0.cmp(&right.0).then(left.1.cmp(&right.1)).then(left.4.cmp(&right.4)));
 let mut boundary=0;let mut manifold=0;let mut non_manifold=0;
 let mut neighbors=if want_neighbors{vec![Vec::new();triangle_count]}else{Vec::new()};
 let mut cursor=0usize;
 while cursor<halves.len(){
  let mut end=cursor+1;
  while end<halves.len()&&halves[end].0==halves[cursor].0&&halves[end].1==halves[cursor].1{end+=1;}
  let n=end-cursor;
  if n==1{boundary+=1;}
  else if n==2&&halves[cursor].2==halves[cursor+1].3&&halves[cursor].3==halves[cursor+1].2{
   manifold+=1;
   if want_neighbors{
    neighbors[halves[cursor].4].push(halves[cursor+1].4);
    neighbors[halves[cursor+1].4].push(halves[cursor].4);
   }
  }else{non_manifold+=1;}
  cursor=end;
 }
 for list in &mut neighbors{list.sort_unstable();list.dedup();}
 let mut interior=0;let mut boundary_vertices=0;let mut locked=0;let mut unused=0;
 for vertex in 0..vertex_count{
  if incident[vertex]==0{unused+=1;continue;}
  match classify_link(&links[offsets[vertex] as usize..offsets[vertex+1] as usize]){
   "interior"=>interior+=1,
   "boundary"=>boundary_vertices+=1,
   _=>locked+=1,
  }
 }
 Ok(TopologyReport{triangles:triangle_count,boundary_edges:boundary,manifold_edges:manifold,non_manifold_edges:non_manifold,interior_vertices:interior,boundary_vertices,locked_vertices:locked,unused_vertices:unused,manifold:non_manifold==0&&locked==0,neighbors})
}
#[cfg(test)] mod tests{
 use super::*;
 #[test] fn triangle_is_boundary_manifold(){
  let report=classify_topology(&[0,1,2],3).expect("topology");
  assert_eq!(report.boundary_edges,3);assert_eq!(report.manifold_edges,0);assert_eq!(report.boundary_vertices,3);assert!(report.manifold);
 }
 #[test] fn tetrahedron_is_closed_manifold(){
  let report=classify_topology(&[0,1,2,0,3,1,1,3,2,0,2,3],4).expect("topology");
  assert_eq!(report.boundary_edges,0);assert_eq!(report.manifold_edges,6);assert_eq!(report.interior_vertices,4);assert!(report.manifold);
 }
 #[test] fn three_triangles_on_one_edge_are_non_manifold(){
  let report=classify_topology(&[0,1,2,0,1,3,0,1,4],5).expect("topology");
  assert_eq!(report.non_manifold_edges,1);assert!(!report.manifold);assert!(report.locked_vertices>=2);
 }
}
