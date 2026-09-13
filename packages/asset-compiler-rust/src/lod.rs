use crate::{qem::simplify_fast,Result};
use rayon::prelude::*;
use serde_json::{json,Value};
#[derive(Clone)]
pub enum LodNode {
 Leaf { cluster_index:usize, triangles:Vec<usize>, min:[f64;3], max:[f64;3] },
 Node { children:Vec<LodNode>, mesh:Vec<u32>, reduced:bool, error_object:f64, min:[f64;3], max:[f64;3] },
}
fn triangle_bounds(triangle_ids:&[usize],indices:&[u32],positions:&[f32])->([f64;3],[f64;3]){
 let mut min=[f64::INFINITY;3];let mut max=[f64::NEG_INFINITY;3];
 for &triangle in triangle_ids{
  for k in 0..3{
   let index=indices[triangle*3+k] as usize;
   for axis in 0..3{
    let value=positions[index*3+axis] as f64;
    min[axis]=min[axis].min(value);max[axis]=max[axis].max(value);
   }
  }
 }
 (min,max)
}

pub fn cluster_adjacency(clusters:&[Vec<usize>],triangle_neighbors:&[Vec<usize>])->Vec<Vec<usize>>{
 let mut cluster_of=vec![usize::MAX;triangle_neighbors.len()];
 for (id,triangles) in clusters.iter().enumerate(){for &triangle in triangles{if triangle<cluster_of.len(){cluster_of[triangle]=id;}}}
 clusters.iter().enumerate().map(|(id,triangles)|{
  let mut next=std::collections::BTreeSet::new();
  for &triangle in triangles{for &neighbour in triangle_neighbors.get(triangle).map(|v|v.as_slice()).unwrap_or(&[]){
   let other=cluster_of.get(neighbour).copied().unwrap_or(usize::MAX);
   if other!=usize::MAX&&other!=id{next.insert(other);}
  }}
  next.into_iter().collect()
 }).collect()
}
fn descendant_clusters(node:&LodNode)->Vec<usize>{
 match node{
  LodNode::Leaf{cluster_index,.. }=>vec![*cluster_index],
  LodNode::Node{children,.. }=>children.iter().flat_map(descendant_clusters).collect(),
 }
}
fn region_adjacency(regions:&[LodNode],cluster_adj:&[Vec<usize>])->Vec<Vec<usize>>{
 let members:Vec<Vec<usize>>=regions.iter().map(descendant_clusters).collect();
 let mut cluster_to_region=vec![usize::MAX;cluster_adj.len()];
 for (region,clusters) in members.iter().enumerate(){
  for &cluster in clusters{
   if cluster>=cluster_to_region.len(){cluster_to_region.resize(cluster+1,usize::MAX);}
   cluster_to_region[cluster]=region;
  }
 }
 members.iter().enumerate().map(|(i,clusters)|{
  let mut next=std::collections::BTreeSet::new();
  for &cluster in clusters{
   for &other in cluster_adj.get(cluster).map(|v|v.as_slice()).unwrap_or(&[]){
    let region=*cluster_to_region.get(other).unwrap_or(&usize::MAX);
    if region!=usize::MAX&&region!=i{next.insert(region);}
   }
  }
  next.into_iter().collect()
 }).collect()
}
fn pair_regions(count:usize,adjacency:&[Vec<usize>])->Vec<Vec<usize>>{
 let mut used=vec![false;count];let mut pairs=Vec::new();
 for i in 0..count{
  if used[i]{continue;}
  let mut best=None;
  for &j in adjacency.get(i).map(|v|v.as_slice()).unwrap_or(&[]){
   if !used[j]&&j!=i&&best.map(|v|j<v).unwrap_or(true){best=Some(j);}
  }
  used[i]=true;
  match best{
   None=>pairs.push(vec![i]),
   Some(j)=>{used[j]=true;let mut pair=vec![i,j];pair.sort_unstable();pairs.push(pair);}
  }
 }
 pairs
}
fn union_bounds(left:&LodNode,right:&LodNode)->([f64;3],[f64;3]){
 let (lmin,lmax)=match left{LodNode::Leaf{min,max,..}|LodNode::Node{min,max,..}=> (min,max)};
 let (rmin,rmax)=match right{LodNode::Leaf{min,max,..}|LodNode::Node{min,max,..}=> (min,max)};
 ([lmin[0].min(rmin[0]),lmin[1].min(rmin[1]),lmin[2].min(rmin[2])],[lmax[0].max(rmax[0]),lmax[1].max(rmax[1]),lmax[2].max(rmax[2])])
}
fn error_of(node:&LodNode)->f64{match node{LodNode::Leaf{..}=>0.0,LodNode::Node{error_object,..}=>*error_object}}
fn push_mesh(out:&mut Vec<u32>,node:&LodNode,source:&[u32]){
 match node{
  LodNode::Leaf{triangles,.. }=>{out.reserve(triangles.len()*3);for &triangle in triangles{out.extend_from_slice(&source[triangle*3..triangle*3+3]);}}
  LodNode::Node{mesh,.. }=>out.extend_from_slice(mesh),
 }
}
struct PairWork{index_list:Vec<u32>,err_left:f64,err_right:f64}
fn bounds_of(node:&LodNode)->([f64;3],[f64;3]){
 match node{LodNode::Leaf{min,max,..}|LodNode::Node{min,max,..}=>(*min,*max)}
}
fn combine_regions(mut regions:Vec<LodNode>)->LodNode{
 while regions.len()>1{
  let mut min=[f64::INFINITY;3];let mut max=[f64::NEG_INFINITY;3];
  for node in &regions{
   let (nmin,nmax)=bounds_of(node);
   for a in 0..3{min[a]=min[a].min(nmin[a]);max[a]=max[a].max(nmax[a]);}
  }
  let mut axis=0;
  for a in 1..3{if max[a]-min[a]>max[axis]-min[axis]{axis=a;}}
  regions.sort_by(|a,b|{
   let (amin,amax)=bounds_of(a);
   let (bmin,bmax)=bounds_of(b);
   (amin[axis]+amax[axis]).total_cmp(&(bmin[axis]+bmax[axis]))
  });
  let current=std::mem::take(&mut regions);
  regions.reserve((current.len()+1)/2);
  let mut iter=current.into_iter();
  while let Some(left)=iter.next(){
   if let Some(right)=iter.next(){
    let (umin,umax)=union_bounds(&left,&right);
    let error=error_of(&left).max(error_of(&right));
    regions.push(LodNode::Node{children:vec![left,right],mesh:Vec::new(),reduced:false,error_object:error,min:umin,max:umax});
   }else{
    regions.push(left);
   }
  }
 }
 regions.remove(0)
}
pub fn build_lod_tree(positions:&[f32],indices:&[u32],clusters:&[Vec<usize>],triangle_neighbors:&[Vec<usize>])->Result<Option<LodNode>>{
 if clusters.is_empty(){return Ok(None);}
 let cluster_adj=cluster_adjacency(clusters,triangle_neighbors);
 let mut regions:Vec<LodNode>=clusters.iter().enumerate().map(|(cluster_index,triangles)|{
  let (min,max)=triangle_bounds(triangles,indices,positions);
  LodNode::Leaf{cluster_index,triangles:triangles.clone(),min,max}
 }).collect();
 let mut adjacency=cluster_adj.clone();
 while regions.len()>1{
  let pairs=pair_regions(regions.len(),&adjacency);
  if pairs.iter().all(|pair|pair.len()==1){break;}
  let works:Vec<Option<PairWork>>=pairs.iter().map(|pair|{
   if pair.len()==1{return None;}
   let left=&regions[pair[0]];let right=&regions[pair[1]];
   let mut index_list=Vec::new();push_mesh(&mut index_list,left,indices);push_mesh(&mut index_list,right,indices);
   Some(PairWork{index_list,err_left:error_of(left),err_right:error_of(right)})
  }).collect();
  let simplified:Result<Vec<Option<(bool,Vec<u32>,f64)>>>=works.into_par_iter().map(|work|->Result<Option<(bool,Vec<u32>,f64)>>{
   let Some(work)=work else{return Ok(None);};
   let simplified=simplify_fast(positions,&work.index_list,(work.index_list.len()/6).max(1))?;
   let progressed=simplified.triangles*3<work.index_list.len();
   let error=if progressed{simplified.error_object+work.err_left.max(work.err_right)}else{work.err_left.max(work.err_right)}; // QEM energy accumulation, not a Hausdorff bound.
   Ok(Some((progressed,if progressed{simplified.indices}else{work.index_list},error)))
  }).collect();
  let simplified=simplified?;
  let prev_len=regions.len();
  let mut slots:Vec<Option<LodNode>>=std::mem::take(&mut regions).into_iter().map(Some).collect();
  let mut next=Vec::with_capacity((prev_len+1)/2);
  for (pair,result) in pairs.into_iter().zip(simplified){
   if pair.len()==1{next.push(slots[pair[0]].take().expect("lod pair slot"));continue;}
   let left=slots[pair[0]].take().expect("lod left");let right=slots[pair[1]].take().expect("lod right");
   let (progressed,mesh,error)=result.expect("lod pair work");
   let (min,max)=union_bounds(&left,&right);
   next.push(LodNode::Node{error_object:error,mesh,reduced:progressed,children:vec![left,right],min,max});
  }
  if next.len()>=prev_len{regions=next;break;}
  adjacency=region_adjacency(&next,&cluster_adj);
  regions=next;
 }
 if regions.is_empty(){Ok(None)}
 else if regions.len()==1{Ok(regions.into_iter().next())}
 else{Ok(Some(combine_regions(regions)))}
}
pub fn to_json(node:&LodNode,cluster_page_ids:&[usize],write_coarse:&mut dyn FnMut(&[u32])->Result<usize>)->Result<Value>{
 match node{
  LodNode::Leaf{cluster_index,min,max,.. }=>Ok(json!({"min":min,"max":max,"page":cluster_page_ids[*cluster_index]})),
  LodNode::Node{children,mesh,reduced,error_object,min,max,.. }=>{
   let mut kids=Vec::new();
   for child in children{kids.push(to_json(child,cluster_page_ids,write_coarse)?);}
   if !*reduced||mesh.is_empty(){return Ok(json!({"min":min,"max":max,"children":kids}));}
   let mut coarse_pages=Vec::new();
   let mut start=0usize;
   while start<mesh.len(){
    let end=(start+crate::CLUSTER_INDEX_COUNT).min(mesh.len());
    coarse_pages.push(write_coarse(&mesh[start..end])?);
    start=end;
   }
   Ok(json!({"min":min,"max":max,"errorObject":error_object,"coarsePages":coarse_pages,"children":kids}))
  }
 }
}
#[cfg(test)] mod tests{
 use super::*;
 use crate::topology::classify_topology;
 fn strip(triangles:usize)->(Vec<f32>,Vec<u32>){
  let mut indices=Vec::new();
  for i in 0..triangles as u32{
   if i%2==0{indices.extend([i,i+1,i+2]);}else{indices.extend([i+1,i,i+2]);}
  }
  let positions=(0..triangles+2).flat_map(|i|[i as f32,0.,0.]).collect();
  (positions,indices)
 }
 fn count_leaves(node:&LodNode)->usize{match node{LodNode::Leaf{..}=>1,LodNode::Node{children,..}=>children.iter().map(count_leaves).sum()}}
 fn count_internal(node:&LodNode)->usize{match node{LodNode::Leaf{..}=>0,LodNode::Node{children,..}=>1+children.iter().map(count_internal).sum::<usize>()}}
 #[test] fn four_clusters_form_a_binary_tree(){
  let (positions,indices)=strip(4);
  let clusters=vec![vec![0],vec![1],vec![2],vec![3]];
  let topology=classify_topology(&indices,positions.len()/3).expect("topology");
  let tree=build_lod_tree(&positions,&indices,&clusters,&topology.neighbors).expect("lod").expect("root");
  assert_eq!(count_leaves(&tree),4);
  assert_eq!(count_internal(&tree),3);
  match tree{LodNode::Node{mesh,error_object,..}=>{assert!(!mesh.is_empty());assert!(error_object>=0.0);}LodNode::Leaf{..}=>panic!("expected node")}
 }
 #[test] fn single_cluster_stays_a_leaf(){
  let (positions,indices)=strip(2);
  let topology=classify_topology(&indices,positions.len()/3).expect("topology");
  let tree=build_lod_tree(&positions,&indices,&[vec![0,1]],&topology.neighbors).expect("lod").expect("root");
  match tree{LodNode::Leaf{cluster_index,..}=>assert_eq!(cluster_index,0),LodNode::Node{..}=>panic!("expected leaf")}
 }
 #[test] fn disconnected_clusters_preserve_all_leaves(){
  let (p1,i1)=strip(2);
  let (p2,i2)=strip(2);
  let mut positions=p1;
  let offset=(positions.len()/3) as u32;
  for v in p2.chunks_exact(3){
   positions.extend([v[0]+100.0,v[1],v[2]]);
  }
  let mut indices=i1;
  for idx in i2{indices.push(idx+offset);}
  let clusters=vec![vec![0],vec![1],vec![2],vec![3]];
  let topology=classify_topology(&indices,positions.len()/3).expect("topology");
  let tree=build_lod_tree(&positions,&indices,&clusters,&topology.neighbors).expect("lod").expect("root");
  assert_eq!(count_leaves(&tree),4);
  match tree{
   LodNode::Node{reduced,mesh,..}=>{assert!(!reduced);assert!(mesh.is_empty());}
   LodNode::Leaf{..}=>panic!("disconnected components must join through a spatial BVH node"),
  }
 }
}
