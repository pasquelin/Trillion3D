use crate::{qem::{simplify_fast,SimplifiedMesh},Result};
use rayon::prelude::*;
use serde_json::{json,Value};
pub fn boundary_signature(indices:&[u32])->Option<Vec<(u32,u32,i32)>>{
 if indices.len()%3!=0{return None;}
 let mut edges=std::collections::BTreeMap::<(u32,u32),(usize,i32)>::new();
 for tri in indices.chunks_exact(3){for k in 0..3{
  let a=tri[k];let b=tri[(k+1)%3];
  let entry=edges.entry((a.min(b),a.max(b))).or_insert((0,0));entry.0+=1;entry.1+=if a<b{1}else{-1};
 }}
 let mut boundary=Vec::new();
 for ((a,b),(count,winding)) in edges{
  if count==1{boundary.push((a,b,winding));}
  else if count!=2||winding!=0{return None;}
 }
 Some(boundary)
}
pub fn preserves_boundary(before:&[u32],after:&[u32])->bool{
 let Some(signature)=boundary_signature(before) else{return false;};
 boundary_signature(after).as_ref()==Some(&signature)
}
pub fn certified_lod_error(min:[f64;3],max:[f64;3])->f64{
 ((max[0]-min[0]).powi(2)+(max[1]-min[1]).powi(2)+(max[2]-min[2]).powi(2)).sqrt()
}
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
// Compare geometric coverage after welding positions only; attribute seams are not holes.
// Degenerate triangles have no covered surface and cannot keep a component alive.
struct CoarseCoverage{
 canonical:Vec<u32>,components:Vec<u32>,required:std::collections::HashSet<u32>,
 boundary:std::collections::HashSet<(u32,u32)>,
}
fn component_root(parent:&mut [u32],mut id:u32)->u32{
 while parent[id as usize]!=id{parent[id as usize]=parent[parent[id as usize] as usize];id=parent[id as usize];}id
}
fn nondegenerate_face(positions:&[f32],tri:&[u32])->bool{
 let point=|id:u32|{let i=id as usize*3;[positions[i] as f64,positions[i+1] as f64,positions[i+2] as f64]};
 let a=point(tri[0]);let b=point(tri[1]);let c=point(tri[2]);
 let ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];let ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
 ab[1]*ac[2]-ab[2]*ac[1]!=0.||ab[2]*ac[0]-ab[0]*ac[2]!=0.||ab[0]*ac[1]-ab[1]*ac[0]!=0.
}
fn geometric_boundary(positions:&[f32],indices:&[u32],canonical:&[u32])->std::collections::HashSet<(u32,u32)>{
 let mut edges=std::collections::HashMap::<(u32,u32),(usize,(u32,u32))>::new();
 for tri in indices.chunks_exact(3){
  if !nondegenerate_face(positions,tri){continue;}
  for k in 0..3{
   let a=canonical[tri[k] as usize];let b=canonical[tri[(k+1)%3] as usize];
   let entry=edges.entry((a.min(b),a.max(b))).or_insert((0,(a,b)));entry.0+=1;
  }
 }
 edges.into_values().filter_map(|(count,edge)|if count==1{Some(edge)}else{None}).collect()
}
impl CoarseCoverage{
 fn new(positions:&[f32],indices:&[u32])->Result<Self>{
  if positions.len()%3!=0||indices.len()%3!=0{return Err(crate::invalid("Invalid LOD coverage geometry"));}
  let mut canonical=vec![u32::MAX;positions.len()/3];
  let mut welded=std::collections::HashMap::new();
  for &id in indices{
   if id as usize>=canonical.len(){return Err(crate::invalid("Invalid LOD coverage index"));}
   if canonical[id as usize]!=u32::MAX{continue;}
   let mut key=[0u32;3];
   for a in 0..3{let value=positions[id as usize*3+a];if !value.is_finite(){return Err(crate::invalid("Nonfinite LOD coverage position"));}key[a]=if value==0.{0}else{value.to_bits()};}
   canonical[id as usize]=*welded.entry(key).or_insert(id);
  }
  let mut components=(0..canonical.len() as u32).collect::<Vec<_>>();
  for tri in indices.chunks_exact(3){
   if !nondegenerate_face(positions,tri){continue;}
   for k in 0..2{let a=component_root(&mut components,canonical[tri[k] as usize]);let b=component_root(&mut components,canonical[tri[k+1] as usize]);components[a as usize]=b;}
  }
  for i in 0..components.len(){components[i]=component_root(&mut components,i as u32);}
  let required=indices.chunks_exact(3).filter(|tri|nondegenerate_face(positions,tri)).map(|tri|components[canonical[tri[0] as usize] as usize]).collect();
  let boundary=geometric_boundary(positions,indices,&canonical);
  Ok(Self{canonical,components,required,boundary})
 }
 fn accepts(&self,positions:&[f32],indices:&[u32])->bool{
  if indices.iter().any(|&id|self.canonical.get(id as usize).copied().unwrap_or(u32::MAX)==u32::MAX){return false;}
  let mut present=std::collections::HashSet::new();
  for tri in indices.chunks_exact(3){
   if !nondegenerate_face(positions,tri){continue;}
   let component=self.components[self.canonical[tri[0] as usize] as usize];
   if tri.iter().any(|&id|self.components[self.canonical[id as usize] as usize]!=component){return false;}
   present.insert(component);
  }
  present==self.required&&geometric_boundary(positions,indices,&self.canonical)==self.boundary
 }
}
const MAX_COARSE_LEVELS:usize=16;
/// Extend a complete replacement mesh with the existing border-locked simplifier.
/// Every level retains its predecessor as fallback and the complete source bounds' certified error.
pub fn append_coarse_levels(positions:&[f32],initial_mesh:&[u32],certified_error:f64,checkpoint:&dyn Fn()->Result<()>)->Result<Vec<SimplifiedMesh>>{
 if !certified_error.is_finite()||certified_error<0.0{return Err(crate::invalid("Invalid certified LOD error"));}
 checkpoint()?;let coverage=CoarseCoverage::new(positions,initial_mesh)?;
 let mut levels:Vec<SimplifiedMesh>=Vec::new();
 for _ in 0..MAX_COARSE_LEVELS{
  checkpoint()?;
  let mesh=levels.last().map(|level|level.indices.as_slice()).unwrap_or(initial_mesh);
  if mesh.len()<=3{break;}
  let mut simplified=simplify_fast(positions,mesh,(mesh.len()/6).max(1))?;
  if simplified.indices.len()>=mesh.len()||simplified.indices.is_empty(){break;}
  if !preserves_boundary(mesh,&simplified.indices)||!coverage.accepts(positions,&simplified.indices){break;}
  simplified.error_object=certified_error;
  levels.push(simplified);
 }
 Ok(levels)
}
fn push_coarsest_mesh(out:&mut Vec<u32>,node:&LodNode,source:&[u32]){
 match node{
  LodNode::Leaf{..}=>push_mesh(out,node,source),
  LodNode::Node{mesh,reduced,children,..}=>{
   if *reduced&&!mesh.is_empty(){out.extend_from_slice(mesh);}
   else{for child in children{push_coarsest_mesh(out,child,source);}}
  }
 }
}
fn extend_lod_tree(positions:&[f32],source:&[u32],mut root:LodNode,checkpoint:&dyn Fn()->Result<()>)->Result<LodNode>{
 let mut cover=Vec::new();push_coarsest_mesh(&mut cover,&root,source);
 let (min,max)=bounds_of(&root);
 for level in append_coarse_levels(positions,&cover,certified_lod_error(min,max),checkpoint)?{
  root=LodNode::Node{children:vec![root],mesh:level.indices,reduced:true,error_object:level.error_object,min,max};
 }
 Ok(root)
}
pub fn build_lod_tree(positions:&[f32],indices:&[u32],clusters:&[Vec<usize>],triangle_neighbors:&[Vec<usize>],checkpoint:&dyn Fn()->Result<()>)->Result<Option<LodNode>>{
 if clusters.is_empty(){return Ok(None);}
 let cluster_adj=cluster_adjacency(clusters,triangle_neighbors);
 let mut regions:Vec<LodNode>=clusters.iter().enumerate().map(|(cluster_index,triangles)|{
  let (min,max)=triangle_bounds(triangles,indices,positions);
  LodNode::Leaf{cluster_index,triangles:triangles.clone(),min,max}
 }).collect();
 let mut adjacency=cluster_adj.clone();
 while regions.len()>1{
  checkpoint()?;
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
   let progressed=simplified.triangles*3<work.index_list.len()&&preserves_boundary(&work.index_list,&simplified.indices);
   let error=work.err_left.max(work.err_right);
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
   next.push(LodNode::Node{error_object:if progressed{certified_lod_error(min,max)}else{error},mesh,reduced:progressed,children:vec![left,right],min,max});
  }
  if next.len()>=prev_len{regions=next;break;}
  adjacency=region_adjacency(&next,&cluster_adj);
  regions=next;
 }
 if regions.is_empty(){return Ok(None);}
 let root=if regions.len()==1{regions.remove(0)}else{combine_regions(regions)};
 Ok(Some(extend_lod_tree(positions,indices,root,checkpoint)?))
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
 #[test] fn replacement_requires_the_same_oriented_boundary(){
  let quad=[0,1,2,0,2,3];
  assert!(preserves_boundary(&quad,&quad));
  assert!(!preserves_boundary(&quad,&[0,1,2]));
  assert!(!preserves_boundary(&quad,&[0,2,1,0,2,3]));
  assert_eq!(certified_lod_error([0.0,0.0,0.0],[2.0,3.0,6.0]),7.0);
 }
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
  let tree=build_lod_tree(&positions,&indices,&clusters,&topology.neighbors,&||Ok(())).expect("lod").expect("root");
  assert_eq!(count_leaves(&tree),4);
  assert_eq!(count_internal(&tree),3);
  match tree{LodNode::Node{mesh,error_object,..}=>{assert!(!mesh.is_empty());assert!(error_object>=0.0);}LodNode::Leaf{..}=>panic!("expected node")}
 }
 #[test] fn single_cluster_stays_a_leaf(){
  let (positions,indices)=strip(2);
  let topology=classify_topology(&indices,positions.len()/3).expect("topology");
  let tree=build_lod_tree(&positions,&indices,&[vec![0,1]],&topology.neighbors,&||Ok(())).expect("lod").expect("root");
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
  let tree=build_lod_tree(&positions,&indices,&clusters,&topology.neighbors,&||Ok(())).expect("lod").expect("root");
  assert_eq!(count_leaves(&tree),4);
  match tree{
   LodNode::Node{reduced,mesh,..}=>{assert!(!reduced);assert!(mesh.is_empty());}
   LodNode::Leaf{..}=>panic!("disconnected components must join through a spatial BVH node"),
  }
 }
 fn grid(nx:usize,ny:usize,offset:f32)->(Vec<f32>,Vec<u32>){
  let positions=(0..=ny).flat_map(|y|(0..=nx).flat_map(move |x|[x as f32+offset,y as f32,0.])).collect();
  let mut indices=Vec::new();let w=(nx+1) as u32;
  for y in 0..ny as u32{for x in 0..nx as u32{let a=y*w+x;indices.extend([a,a+1,a+w,a+1,a+w+1,a+w]);}}
  (positions,indices)
 }
 fn exact_leaf(positions:&[f32],indices:&[u32],cluster_index:usize,triangles:Vec<usize>)->LodNode{
  let (min,max)=triangle_bounds(&triangles,indices,positions);
  LodNode::Leaf{cluster_index,triangles,min,max}
 }
 #[test] fn root_extension_preserves_disconnected_exact_subtree(){
  let (mut positions,mut indices)=grid(8,8,0.);
  let (other_positions,other_indices)=grid(8,8,100.);
  let vertex_offset=positions.len() as u32/3;let middle=indices.len()/3;
  positions.extend(other_positions);indices.extend(other_indices.into_iter().map(|v|v+vertex_offset));
  let left=exact_leaf(&positions,&indices,0,(0..middle).collect());
  let right=exact_leaf(&positions,&indices,1,(middle..indices.len()/3).collect());
  let (min,max)=union_bounds(&left,&right);
  let original=LodNode::Node{children:vec![left,right],mesh:Vec::new(),reduced:false,error_object:0.,min,max};
  let old_json=to_json(&original,&[0,1],&mut |_|panic!("exact tree")).expect("serialize original");
  let expanded=extend_lod_tree(&positions,&indices,original,&||Ok(())).expect("extend");
  let mut node=&expanded;let mut additional=0;
  while let LodNode::Node{children,mesh,reduced,error_object,min:level_min,max:level_max,..}=node{
   if children.len()!=1{break;}
   assert!(*reduced);assert!(!mesh.is_empty());
   assert_eq!(*error_object,11728_f64.sqrt(),"the complete replacement needs its root bounds, even when its unreduced child has zero error");
   assert_eq!((*level_min,*level_max),(min,max));
   assert!(mesh.iter().any(|&v|v<vertex_offset));
   assert!(mesh.iter().any(|&v|v>=vertex_offset));
   additional+=1;node=&children[0];
  }
  assert!(additional>0);assert_eq!(count_leaves(&expanded),2);
  assert_eq!(to_json(node,&[0,1],&mut |_|panic!("exact tree")).expect("old subtree"),old_json);
  let mut page_id=2;
  to_json(&expanded,&[0,1],&mut |ids|{assert!(!ids.is_empty());assert!(ids.len()<=crate::CLUSTER_INDEX_COUNT);let id=page_id;page_id+=1;Ok(id)}).expect("page size");
 }
 #[test] fn complete_cover_uses_coarse_mesh_or_all_unreduced_children(){
  let (positions,indices)=grid(2,2,0.);
  let leaf=exact_leaf(&positions,&indices,0,(0..indices.len()/3).collect());
  let (min,max)=bounds_of(&leaf);
  let coarse=vec![0,1,3];
  let root=LodNode::Node{children:vec![leaf],mesh:coarse.clone(),reduced:true,error_object:1.,min,max};
  let mut cover=Vec::new();push_coarsest_mesh(&mut cover,&root,&indices);
  assert_eq!(cover,coarse);
 }
 #[test] fn additional_levels_keep_the_certified_bound_and_stop_when_blocked(){
  let (mut positions,indices)=grid(8,8,0.);
  for point in positions.chunks_exact_mut(3){point[2]=point[0]*point[1]*0.01;}
  let bound=129_f64.sqrt(); // Conservative bound for the 8 x 8 x 0.64 input.
  let levels=append_coarse_levels(&positions,&indices,bound,&||Ok(())).expect("levels");
  assert!(!levels.is_empty());assert!(levels.len()<=MAX_COARSE_LEVELS);
  let mut triangles=indices.len()/3;
  for level in levels{
   assert!(level.triangles>0&&level.triangles<triangles);
   assert_eq!(level.error_object,bound,"a complete replacement keeps its certified bound without accumulating the local QEM estimate");
   assert!(preserves_boundary(&indices,&level.indices));
   assert!(level.indices.iter().all(|&v|(v as usize)<positions.len()/3));
   triangles=level.triangles;
  }
  assert!(append_coarse_levels(&positions,&[0,1,9],0.,&||Ok(())).expect("locked triangle").is_empty());
 }
 #[test] fn additional_levels_reject_nonmanifold_indexed_edges(){
  let (positions,mut indices)=grid(8,8,0.);
  indices.extend([0,1,9]);
  assert!(boundary_signature(&indices).is_none());
  assert!(append_coarse_levels(&positions,&indices,128_f64.sqrt(),&||Ok(())).expect("unsupported boundary").is_empty());
 }
 #[test] fn root_extension_can_refine_singleton_without_losing_its_leaf(){
  let (positions,indices)=grid(8,8,0.);
  let leaf=exact_leaf(&positions,&indices,0,(0..indices.len()/3).collect());
  let expanded=extend_lod_tree(&positions,&indices,leaf,&||Ok(())).expect("extend");
  assert_eq!(count_leaves(&expanded),1);
  match expanded{LodNode::Node{mesh,..}=>assert!(mesh.len()<indices.len()),_=>panic!("coarse parent")}
 }
 #[test] fn additional_planar_levels_preserve_boundary_edges_and_covered_area(){
  fn boundaries(ids:&[u32])->std::collections::BTreeSet<(u32,u32)>{
   let mut counts=std::collections::BTreeMap::new();
   for tri in ids.chunks_exact(3){for k in 0..3{let a=tri[k];let b=tri[(k+1)%3];*counts.entry((a.min(b),a.max(b))).or_insert(0usize)+=1;}}
   counts.into_iter().filter_map(|(edge,n)|if n==1{Some(edge)}else{None}).collect()
  }
  fn area(positions:&[f32],ids:&[u32])->f64{
   ids.chunks_exact(3).map(|tri|{let [a,b,c]=[tri[0] as usize*3,tri[1] as usize*3,tri[2] as usize*3];
    let signed=((positions[b]-positions[a])*(positions[c+1]-positions[a+1])-(positions[b+1]-positions[a+1])*(positions[c]-positions[a])) as f64/2.;
    assert!(signed>0.,"face orientation must remain positive");signed
   }).sum()
  }
  let (positions,indices)=grid(8,8,0.);let old_border=boundaries(&indices);let old_area=area(&positions,&indices);
  for level in append_coarse_levels(&positions,&indices,0.,&||Ok(())).expect("levels"){
   assert!(preserves_boundary(&indices,&level.indices));
   assert_eq!(boundaries(&level.indices),old_border);
   assert!((area(&positions,&level.indices)-old_area).abs()<1e-9);
  }
 }
 #[test] fn additional_levels_keep_small_closed_components_nondegenerate(){
  let (mut positions,mut indices)=grid(8,8,0.);
  for value in &mut positions{*value*=100.;}
  let v=(positions.len()/3) as u32;
  positions.extend([1000.,0.,0.,1000.1,0.,0.,1000.,0.1,0.,1000.,0.,0.1]);
  indices.extend([v,v+2,v+1,v,v+1,v+3,v+1,v+2,v+3,v+2,v,v+3]);
  for level in append_coarse_levels(&positions,&indices,0.,&||Ok(())).expect("levels"){
   assert!(level.indices.chunks_exact(3).any(|tri|tri.iter().all(|&id|id>=v)&&nondegenerate_face(&positions,tri)),"small closed component disappeared");
  }
 }
 #[test] fn coverage_rejects_a_component_flattened_to_distinct_coincident_indices(){
  let positions=vec![0.,0.,0.,1.,0.,0.,0.,1.,0.,10.,0.,0.,11.,0.,0.,10.,1.,0.,10.,0.,0.];
  let source=vec![0,1,2,3,4,5,3,4,6];
  let coverage=CoarseCoverage::new(&positions,&source).expect("coverage");
  assert_eq!(coverage.required.len(),2);
  let flattened=vec![0,1,2,3,4,6];
  assert!(!nondegenerate_face(&positions,&flattened[3..]));
  assert!(!coverage.accepts(&positions,&flattened));
  assert!(coverage.accepts(&positions,&[0,1,2,3,4,5]));
 }
 #[test] fn additional_levels_honor_cancellation_before_simplification(){
  let (positions,indices)=grid(8,8,0.);
  let error=append_coarse_levels(&positions,&indices,0.,&||Err(crate::invalid("cancelled"))).err().expect("cancelled");
  assert!(error.to_string().contains("cancelled"));
 }

}
