//! Virtualized-geometry cluster DAG.
//!
//! Level 0 is a spatial partition of the source triangles into small clusters. Every level after
//! that groups 8 to 32 neighbouring clusters, simplifies the merged group with its border locked,
//! and re-splits the result into clusters of the same size. Each cluster therefore carries two
//! monotone quantities: `lod_error`, the error of the group that produced it, and `parent_error`,
//! the error of the group that replaces it. A flat runtime cut `parent_error > t >= lod_error`
//! then covers the surface exactly once.
//!
//! The metric is positional only: indices keep pointing at the source vertices, so UV, normals and
//! colours survive untouched, but they do not participate in the simplification error yet.
use std::collections::HashMap;
use crate::{invalid,Result};
use crate::qem::{compact_region,simplify_with_locked_vertices};
use rayon::prelude::*;
use crate::perf::{PHASES,Timer};

/// Triangles per cluster. Matches the page budget used by the exact path.
pub const DAG_CLUSTER_TRIANGLES:usize=128;
/// meshopt caps a meshlet at 255 vertices; a 128 triangle cluster never needs more.
pub const DAG_CLUSTER_VERTICES:usize=255;
pub const DAG_GROUP_MIN:usize=8;
pub const DAG_GROUP_MAX:usize=32;
/// 2x reduction per level bounds the depth of a 2^24 triangle mesh.
pub const DAG_MAX_LEVELS:usize=32;
/// meshopt's relative error ceiling. Large enough to always reach the triangle target.
const SIMPLIFY_ERROR_CEILING:f32=1.0;

#[derive(Clone,Debug)]
pub struct DagCluster{
 /// Triangle list in the source vertex buffer, three indices per triangle.
 pub indices:Vec<u32>,
 pub level:usize,
 /// Object-space error of the simplification that produced this cluster. Zero at level 0.
 pub lod_error:f64,
 /// Object-space error of the group that replaces this cluster. Infinite for a root.
 pub parent_error:f64,
 /// Bounds of the group that produced this cluster, used to project `lod_error`.
 pub sphere:[f64;4],
 /// Bounds of the group that replaces this cluster, used to project `parent_error`.
 pub parent_sphere:[f64;4],
 /// One cluster of the group that replaces this one. `None` for a root. Builder bookkeeping only.
 pub replacement:Option<usize>,
 /// Earliest source triangle this cluster descends from. Keeps a transparent draw order close to
 /// the source order, which spatial clustering would otherwise scramble.
 pub source_rank:u32,
 /// Group that replaces this cluster, `None` for a root. The runtime swaps a whole group at once.
 pub group:Option<usize>,
 /// Group whose simplification produced this cluster, `None` at level 0. Coarsening a group means
 /// coarsening every group that produced its children, so the runtime needs both links.
 pub source:Option<usize>,
}
impl DagCluster{
 pub fn triangles(&self)->usize{self.indices.len()/3}
 pub fn is_root(&self)->bool{!self.parent_error.is_finite()}
}

// ---------------------------------------------------------------- geometry helpers

fn point(positions:&[f32],id:u32)->[f64;3]{
 let i=id as usize*3;
 [positions[i] as f64,positions[i+1] as f64,positions[i+2] as f64]
}

/// AABB centre plus the farthest vertex. Conservative and deterministic.
pub fn bounding_sphere(positions:&[f32],indices:&[u32])->[f64;4]{
 let mut min=[f64::INFINITY;3];let mut max=[f64::NEG_INFINITY;3];
 for &id in indices{let p=point(positions,id);for a in 0..3{min[a]=min[a].min(p[a]);max[a]=max[a].max(p[a]);}}
 if !min[0].is_finite(){return [0.0,0.0,0.0,0.0];}
 let centre=[(min[0]+max[0])*0.5,(min[1]+max[1])*0.5,(min[2]+max[2])*0.5];
 let mut radius=0.0_f64;
 for &id in indices{
  let p=point(positions,id);
  let d=((p[0]-centre[0]).powi(2)+(p[1]-centre[1]).powi(2)+(p[2]-centre[2]).powi(2)).sqrt();
  if d>radius{radius=d;}
 }
 [centre[0],centre[1],centre[2],radius]
}

fn merge_spheres(left:[f64;4],right:[f64;4])->[f64;4]{
 if right[3]<0.0{return left;}
 if left[3]<0.0{return right;}
 let delta=[right[0]-left[0],right[1]-left[1],right[2]-left[2]];
 let distance=(delta[0]*delta[0]+delta[1]*delta[1]+delta[2]*delta[2]).sqrt();
 if distance+right[3]<=left[3]{return left;}
 if distance+left[3]<=right[3]{return right;}
 let radius=(distance+left[3]+right[3])*0.5;
 let t=if distance>0.0{(radius-left[3])/distance}else{0.0};
 [left[0]+delta[0]*t,left[1]+delta[1]*t,left[2]+delta[2]*t,radius]
}

/// Monotone parent bounds: the result encloses every input sphere.
pub fn enclosing_sphere(spheres:&[[f64;4]])->[f64;4]{
 let mut result=[0.0,0.0,0.0,-1.0];
 for &sphere in spheres{result=merge_spheres(result,sphere);}
 if result[3]<0.0{result[3]=0.0;}
 result
}

/// Local vertex buffer for a triangle region. Dense inputs use a direct table, sparse ones a map.
/// Spatial clusters of at most `max_triangles` triangles, built with meshopt's meshlet builder.
/// meshopt 0.4 exposes `build_meshlets`; it does not expose a cluster partitioner, so grouping
/// below uses a local recursive bisection instead.
pub fn cluster_triangles(positions:&[f32],indices:&[u32],max_triangles:usize)->Result<Vec<Vec<u32>>>{
 if indices.is_empty()||indices.len()%3!=0{return Err(invalid("Index count must be a positive multiple of three"));}
 if max_triangles==0||max_triangles%4!=0||max_triangles>512{return Err(invalid("Cluster triangle budget must be a positive multiple of four up to 512"));}
 if indices.len()/3<=max_triangles{return Ok(vec![indices.to_vec()]);}
 let (compact_pos,compact_idx,remap)=compact_region(positions,indices);
 let bytes=unsafe{std::slice::from_raw_parts(compact_pos.as_ptr() as *const u8,compact_pos.len()*4)};
 let vertices=meshopt::VertexDataAdapter::new(bytes,12,0).map_err(|_|invalid("POSITION adapter"))?;
 let meshlets=meshopt::build_meshlets(&compact_idx,&vertices,DAG_CLUSTER_VERTICES,max_triangles,0.0);
 if meshlets.is_empty(){return Err(invalid("Meshlet builder produced no cluster"));}
 let mut clusters=Vec::with_capacity(meshlets.len());
 for i in 0..meshlets.len(){
  let meshlet=meshlets.get(i);
  let mut cluster=Vec::with_capacity(meshlet.triangles.len());
  for corner in meshlet.triangles{
   let local=*meshlet.vertices.get(*corner as usize).ok_or_else(||invalid("Meshlet vertex out of range"))?;
   cluster.push(*remap.get(local as usize).ok_or_else(||invalid("Meshlet remap out of range"))?);
  }
  if cluster.is_empty(){continue;}
  clusters.push(cluster);
 }
 if clusters.is_empty(){return Err(invalid("Meshlet builder produced no triangle"));}
 Ok(clusters)
}

// ---------------------------------------------------------------- cluster graph

fn edge_key(a:u32,b:u32)->u64{let (lo,hi)=if a<b{(a,b)}else{(b,a)};((lo as u64)<<32)|hi as u64}

/// Shared-edge weights between clusters. Only cluster-boundary edges can be shared, so collecting
/// those keeps the pass proportional to the boundary rather than to the triangle count.
pub fn cluster_adjacency(clusters:&[&[u32]])->Vec<Vec<(u32,u32)>>{
 let mut records:Vec<(u64,u32)>=Vec::new();
 let mut local:HashMap<u64,u32>=HashMap::new();
 for (id,indices) in clusters.iter().enumerate(){
  local.clear();
  for tri in indices.chunks_exact(3){for k in 0..3{*local.entry(edge_key(tri[k],tri[(k+1)%3])).or_insert(0)+=1;}}
  for (&key,&count) in local.iter(){if count==1{records.push((key,id as u32));}}
 }
 records.sort_unstable();
 let mut weights:Vec<HashMap<u32,u32>>=vec![HashMap::new();clusters.len()];
 let mut start=0usize;
 while start<records.len(){
  let mut end=start+1;
  while end<records.len()&&records[end].0==records[start].0{end+=1;}
  for i in start..end{for j in i+1..end{
   let (a,b)=(records[i].1,records[j].1);
   if a==b{continue;}
   *weights[a as usize].entry(b).or_insert(0)+=1;
   *weights[b as usize].entry(a).or_insert(0)+=1;
  }}
  start=end;
 }
 weights.into_iter().map(|map|{let mut list:Vec<(u32,u32)>=map.into_iter().collect();list.sort_unstable();list}).collect()
}

/// Recursive bisection of the cluster graph into partitions of at most `max` members.
/// Splits on the longest axis of the cluster centres, then trades members across the cut while the
/// shared-edge weight drops, which is the cheap stand-in for a METIS-style graph partitioner.
pub fn group_clusters(centres:&[[f64;3]],adjacency:&[Vec<(u32,u32)>],max:usize)->Vec<Vec<usize>>{
 let mut groups=Vec::new();
 let mut side=vec![0u8;centres.len()];
 let mut members:Vec<usize>=(0..centres.len()).collect();
 let mut stack=vec![(0usize,members.len())];
 while let Some((from,to))=stack.pop(){
  let len=to-from;
  if len==0{continue;}
  if len<=max{groups.push(members[from..to].to_vec());continue;}
  let slice=&mut members[from..to];
  let mut min=[f64::INFINITY;3];let mut max_bound=[f64::NEG_INFINITY;3];
  for &m in slice.iter(){for a in 0..3{min[a]=min[a].min(centres[m][a]);max_bound[a]=max_bound[a].max(centres[m][a]);}}
  let mut axis=0;for a in 1..3{if max_bound[a]-min[a]>max_bound[axis]-min[axis]{axis=a;}}
  slice.sort_unstable_by(|&a,&b|centres[a][axis].total_cmp(&centres[b][axis]).then(a.cmp(&b)));
  let middle=len/2;
  for (i,&m) in slice.iter().enumerate(){side[m]=if i<middle{0}else{1};}
  refine_bisection(slice,&mut side,adjacency,len*3/8);
  slice.sort_unstable_by_key(|&m|(side[m],m));
  let split=from+slice.iter().filter(|&&m|side[m]==0).count();
  stack.push((from,split));stack.push((split,to));
 }
 groups.sort_unstable_by_key(|group|group.first().copied().unwrap_or(usize::MAX));
 groups
}

fn refine_bisection(slice:&mut [usize],side:&mut [u8],adjacency:&[Vec<(u32,u32)>],floor:usize){
 let mut present:std::collections::HashSet<usize>=std::collections::HashSet::with_capacity(slice.len());
 for &m in slice.iter(){present.insert(m);}
 let mut counts=[0usize;2];
 for &m in slice.iter(){counts[side[m] as usize]+=1;}
 for _ in 0..2{
  let mut moved=false;
  for &m in slice.iter(){
   let here=side[m] as usize;
   if counts[here]<=floor{continue;}
   let mut internal=0i64;let mut external=0i64;
   for &(other,weight) in adjacency.get(m).map(|v|v.as_slice()).unwrap_or(&[]){
    if !present.contains(&(other as usize)){continue;}
    if side[other as usize] as usize==here{internal+=weight as i64;}else{external+=weight as i64;}
   }
   if external>internal{
    side[m]=1-side[m];counts[here]-=1;counts[1-here]+=1;moved=true;
   }
  }
  if !moved{break;}
 }
}

// ---------------------------------------------------------------- group reduction

fn normalized_bits(value:f32)->u32{if value==0.0{0}else{value.to_bits()}}
fn position_key(positions:&[f32],id:u32)->[u32;3]{
 let i=id as usize*3;
 [normalized_bits(positions[i]),normalized_bits(positions[i+1]),normalized_bits(positions[i+2])]
}
/// Canonical vertex per position: duplicated vertices at UV or normal seams are one point, so a
/// lock placed on one copy locks every copy and no seam can crack.
pub fn weld_positions(positions:&[f32],indices:&[u32])->Vec<u32>{
 let count=positions.len()/3;
 let mut canonical:Vec<u32>=(0..count as u32).collect();
 let mut seen:HashMap<[u32;3],u32>=HashMap::with_capacity(indices.len()/2);
 let mut visited=vec![false;count];
 for &id in indices{
  let slot=id as usize;
  if slot>=count||visited[slot]{continue;}
  visited[slot]=true;
  canonical[slot]=*seen.entry(position_key(positions,id)).or_insert(id);
 }
 canonical
}
const LOCK_SHARED:u32=u32::MAX-1;
/// Lock table for one level: a vertex is locked when another group of the same level also uses its
/// position. The primitive's own open boundary belongs to a single group, so it stays free and keeps
/// simplifying; only the seams between groups are pinned, which is what keeps the cut watertight.
pub fn level_locks(weld:&[u32],clusters:&[&[u32]],groups:&[Vec<usize>])->Vec<bool>{
 let mut owner=vec![u32::MAX;weld.len()];
 for (id,group) in groups.iter().enumerate(){
  let id=id as u32;
  for &slot in group{
   for &vertex in clusters[slot]{
    let canonical=weld[vertex as usize] as usize;
    if owner[canonical]==u32::MAX{owner[canonical]=id;}
    else if owner[canonical]!=id{owner[canonical]=LOCK_SHARED;}
   }
  }
 }
 (0..weld.len()).map(|vertex|owner[weld[vertex] as usize]==LOCK_SHARED).collect()
}

struct GroupReduction{error:f64,sphere:[f64;4],clusters:Vec<Vec<u32>>,source_rank:u32}
/// One reduction of the DAG, kept so the runtime can swap a whole group at once.
///
/// `children` is the fine representation of the group's surface, `outputs` the coarse one its
/// simplification produced. Either one covers the group exactly, never both, so a runtime that
/// cannot show every child can fall back to the outputs without a hole and without drawing twice.
#[derive(Clone,Debug)]
pub struct DagGroup{
 pub level:usize,
 pub error:f64,
 pub sphere:[f64;4],
 pub children:Vec<usize>,
 pub outputs:Vec<usize>,
}
/// Why a group did not produce a coarser level. Its clusters then become roots.
#[derive(Clone,Copy,PartialEq,Eq,Debug)]
pub enum GroupOutcome{Reduced,TooSmall,NoCollapse,BorderLost,UnusableError}
/// Per-level tally of group outcomes, reported by the compiler so a stalled DAG is visible.
#[derive(Clone,Copy,Default,Debug)]
pub struct GroupTally{pub reduced:usize,pub too_small:usize,pub no_collapse:usize,pub border_lost:usize,pub unusable_error:usize}
impl GroupTally{
 fn record(&mut self,outcome:GroupOutcome){
  match outcome{
   GroupOutcome::Reduced=>self.reduced+=1,
   GroupOutcome::TooSmall=>self.too_small+=1,
   GroupOutcome::NoCollapse=>self.no_collapse+=1,
   GroupOutcome::BorderLost=>self.border_lost+=1,
   GroupOutcome::UnusableError=>self.unusable_error+=1,
  }
 }
}

struct GroupReductionInput<'a>{positions:&'a [f32],locks:&'a [bool],weld:&'a [u32]}
fn reduce_group(input:&GroupReductionInput,children:&[&DagCluster])->Result<std::result::Result<GroupReduction,GroupOutcome>>{
 let positions=input.positions;
 let mut merged=Vec::new();
 let mut spheres=Vec::with_capacity(children.len());
 let mut child_error=0.0_f64;
 let mut source_rank=u32::MAX;
 for child in children{
  merged.extend_from_slice(&child.indices);
  spheres.push(child.sphere);
  child_error=child_error.max(child.lod_error);
  source_rank=source_rank.min(child.source_rank);
 }
 let sphere=enclosing_sphere(&spheres);
 let triangles=merged.len()/3;
 if triangles<2{return Ok(Err(GroupOutcome::TooSmall));}
 let locks=input.locks;
 let simplified={let _t=Timer::new(&PHASES.simplify);simplify_with_locked_vertices(positions,&merged,triangles/2,SIMPLIFY_ERROR_CEILING,&|vertex|locks.get(vertex as usize).copied().unwrap_or(true))?};
 if simplified.triangles>=triangles||simplified.indices.is_empty(){return Ok(Err(GroupOutcome::NoCollapse));}
 // Every vertex shared with another group must survive, or the two groups no longer meet.
 let weld=input.weld;
 let required:std::collections::HashSet<u32>=merged.iter().filter(|&&id|locks.get(id as usize).copied().unwrap_or(false)).map(|&id|weld[id as usize]).collect();
 if !required.is_empty(){
  let kept:std::collections::HashSet<u32>=simplified.indices.iter().map(|&id|weld[id as usize]).collect();
  if !required.iter().all(|id|kept.contains(id)){return Ok(Err(GroupOutcome::BorderLost));}
 }
 let error=simplified.error_object.max(child_error);
 if !error.is_finite(){return Ok(Err(GroupOutcome::UnusableError));}
 let clusters={let _t=Timer::new(&PHASES.resplit);cluster_triangles(positions,&simplified.indices,DAG_CLUSTER_TRIANGLES)?};
 Ok(Ok(GroupReduction{error,sphere,clusters,source_rank}))
}

/// Same build, plus the groups that produced it and the per-level tally.
pub fn build_dag_tallied(positions:&[f32],indices:&[u32],checkpoint:&(dyn Fn()->Result<()>+Sync))->Result<(Vec<DagCluster>,Vec<DagGroup>,Vec<GroupTally>)>{
 checkpoint()?;
 let weld={let _t=Timer::new(&PHASES.weld);weld_positions(positions,indices)};
 // Rank of the source triangle each vertex first appears in, used to keep the draw order stable.
 let mut first_use=vec![u32::MAX;positions.len()/3];
 for (offset,&vertex) in indices.iter().enumerate(){
  let slot=vertex as usize;
  if slot<first_use.len()&&first_use[slot]==u32::MAX{first_use[slot]=(offset/3) as u32;}
 }
 let mut dag:Vec<DagCluster>=Vec::new();
 let level0={let _t=Timer::new(&PHASES.cluster_level0);cluster_triangles(positions,indices,DAG_CLUSTER_TRIANGLES)?};
 for cluster in level0{
  let sphere=bounding_sphere(positions,&cluster);
  let source_rank=cluster.iter().map(|&v|first_use.get(v as usize).copied().unwrap_or(u32::MAX)).min().unwrap_or(0);
  dag.push(DagCluster{indices:cluster,level:0,lod_error:0.0,parent_error:f64::INFINITY,sphere,parent_sphere:sphere,replacement:None,source_rank,group:None,source:None});
 }
 let mut tallies:Vec<GroupTally>=Vec::new();
 let mut reductions_kept:Vec<DagGroup>=Vec::new();
 let mut current:Vec<usize>=(0..dag.len()).collect();
 for level in 1..=DAG_MAX_LEVELS{
  checkpoint()?;
  if current.len()<2{break;}
  let lists:Vec<&[u32]>=current.iter().map(|&id|dag[id].indices.as_slice()).collect();
  let adjacency_by_slot={let _t=Timer::new(&PHASES.adjacency);cluster_adjacency(&lists)};
  let centres:Vec<[f64;3]>=current.iter().map(|&id|{let s=dag[id].sphere;[s[0],s[1],s[2]]}).collect();
  let groups={let _t=Timer::new(&PHASES.grouping);group_clusters(&centres,&adjacency_by_slot,DAG_GROUP_MAX)};
  if groups.len()>=current.len(){break;}
  let locks={let _t=Timer::new(&PHASES.locks);level_locks(&weld,&lists,&groups)};
  let input=GroupReductionInput{positions,locks:&locks,weld:&weld};
  let reductions:Vec<std::result::Result<GroupReduction,GroupOutcome>>=groups.par_iter().map(|group|->Result<std::result::Result<GroupReduction,GroupOutcome>>{
   checkpoint()?;
   let children:Vec<&DagCluster>=group.iter().map(|&slot|&dag[current[slot]]).collect();
   reduce_group(&input,&children)
  }).collect::<Result<Vec<_>>>()?;
  let mut next=Vec::new();
  let mut tally=GroupTally::default();
  for (group,reduction) in groups.iter().zip(reductions){
   let reduction=match reduction{Ok(reduction)=>{tally.record(GroupOutcome::Reduced);reduction}Err(outcome)=>{tally.record(outcome);continue}};
   let first_parent=dag.len();
   let group_index=reductions_kept.len();
   let mut children=Vec::with_capacity(group.len());
   for &slot in group{
    let id=current[slot];
    dag[id].parent_error=reduction.error;
    dag[id].parent_sphere=reduction.sphere;
    dag[id].replacement=Some(first_parent);
    dag[id].group=Some(group_index);
    children.push(id);
   }
   let mut outputs=Vec::with_capacity(reduction.clusters.len());
   for cluster in reduction.clusters{
    outputs.push(dag.len());
    next.push(dag.len());
    dag.push(DagCluster{indices:cluster,level,lod_error:reduction.error,parent_error:f64::INFINITY,sphere:reduction.sphere,parent_sphere:reduction.sphere,replacement:None,source_rank:reduction.source_rank,group:None,source:Some(group_index)});
   }
   reductions_kept.push(DagGroup{level,error:reduction.error,sphere:reduction.sphere,children,outputs});
  }
  tallies.push(tally);
  if next.is_empty(){break;}
  let progressed=next.len()<current.len();
  current=next;
  if !progressed{break;}
 }
 Ok((dag,reductions_kept,tallies))
}

// ---------------------------------------------------------------- culling hierarchy

/// Children per interior node, and clusters per leaf.
pub const CULLING_BRANCHING:usize=8;
pub const CULLING_LEAF:usize=8;
/// One node of the per-primitive culling hierarchy.
///
/// `sphere` encloses every `parent_sphere` of the subtree and `max_parent_error` is the largest
/// `parent_error` in it, so a single projection bounds the whole subtree from above: when that bound
/// already fits the pixel budget, no cluster below can be selected and the subtree is skipped.
#[derive(Clone,Debug)]
pub struct CullingNode{
 pub min:[f64;3],pub max:[f64;3],
 pub sphere:[f64;4],
 pub max_parent_error:f64,
 pub first_child:usize,pub child_count:usize,
 pub first_cluster:usize,pub cluster_count:usize,
}
impl Default for CullingNode{
 fn default()->Self{Self{min:[0.0;3],max:[0.0;3],sphere:[0.0;4],max_parent_error:0.0,first_child:0,child_count:0,first_cluster:0,cluster_count:0}}
}
fn cluster_bounds(positions:&[f32],indices:&[u32])->([f64;3],[f64;3]){
 let mut min=[f64::INFINITY;3];let mut max=[f64::NEG_INFINITY;3];
 for &id in indices{let p=point(positions,id);for a in 0..3{min[a]=min[a].min(p[a]);max[a]=max[a].max(p[a]);}}
 if !min[0].is_finite(){return ([0.0;3],[0.0;3]);}
 (min,max)
}
/// Order the clusters so every node owns a contiguous range, and return the flat node array.
/// Node 0 is the root; a leaf has `child_count == 0`.
///
/// The root holds one subtree per level and only those subtrees subdivide space. Mixing levels
/// under one node would give it the coarsest `max_parent_error` of the whole region, and the
/// runtime could then never skip the fine clusters hiding under it.
pub fn build_culling_bvh(positions:&[f32],clusters:&[DagCluster])->(Vec<usize>,Vec<CullingNode>){
 let mut order:Vec<usize>=(0..clusters.len()).collect();
 let mut nodes:Vec<CullingNode>=Vec::new();
 if clusters.is_empty(){return (order,nodes);}
 let boxes:Vec<([f64;3],[f64;3])>=clusters.iter().map(|cluster|cluster_bounds(positions,&cluster.indices)).collect();
 let centres:Vec<[f64;3]>=boxes.iter().map(|(min,max)|[(min[0]+max[0])*0.5,(min[1]+max[1])*0.5,(min[2]+max[2])*0.5]).collect();
 order.sort_unstable_by_key(|&id|(clusters[id].level,id));
 let mut level_ranges=Vec::new();
 let mut start=0usize;
 while start<order.len(){
  let level=clusters[order[start]].level;
  let mut end=start+1;
  while end<order.len()&&clusters[order[end]].level==level{end+=1;}
  level_ranges.push((start,end));
  start=end;
 }
 nodes.push(CullingNode::default());
 let mut queue=std::collections::VecDeque::new();
 if level_ranges.len()<2{
  queue.push_back((0usize,0usize,clusters.len()));
 }else{
  let first_child=1usize;
  nodes[0].first_child=first_child;nodes[0].child_count=level_ranges.len();
  nodes.resize(first_child+level_ranges.len(),CullingNode::default());
  for (offset,&(from,to)) in level_ranges.iter().enumerate(){queue.push_back((first_child+offset,from,to));}
  let mut min=[f64::INFINITY;3];let mut max=[f64::NEG_INFINITY;3];
  let mut spheres=Vec::with_capacity(clusters.len());
  let mut max_parent_error=0.0_f64;
  for &id in &order{
   let (bmin,bmax)=boxes[id];
   for a in 0..3{min[a]=min[a].min(bmin[a]);max[a]=max[a].max(bmax[a]);}
   spheres.push(clusters[id].parent_sphere);
   if clusters[id].parent_error>max_parent_error{max_parent_error=clusters[id].parent_error;}
  }
  nodes[0].min=min;nodes[0].max=max;
  nodes[0].sphere=enclosing_sphere(&spheres);
  nodes[0].max_parent_error=max_parent_error;
 }
 while let Some((index,start,end))=queue.pop_front(){
  let mut min=[f64::INFINITY;3];let mut max=[f64::NEG_INFINITY;3];
  let mut spheres=Vec::with_capacity(end-start);
  let mut max_parent_error=0.0_f64;
  for &id in &order[start..end]{
   let (bmin,bmax)=boxes[id];
   for a in 0..3{min[a]=min[a].min(bmin[a]);max[a]=max[a].max(bmax[a]);}
   spheres.push(clusters[id].parent_sphere);
   if clusters[id].parent_error>max_parent_error{max_parent_error=clusters[id].parent_error;}
  }
  nodes[index].min=min;nodes[index].max=max;
  nodes[index].sphere=enclosing_sphere(&spheres);
  nodes[index].max_parent_error=max_parent_error;
  if end-start<=CULLING_LEAF{
   nodes[index].first_cluster=start;nodes[index].cluster_count=end-start;
   continue;
  }
  // Three median splits on the longest axis give the eight children.
  let mut ranges=vec![(start,end)];
  for _ in 0..CULLING_BRANCHING.trailing_zeros(){
   let mut next=Vec::with_capacity(ranges.len()*2);
   for (from,to) in ranges{
    if to-from<2{next.push((from,to));continue;}
    let slice=&mut order[from..to];
    let mut low=[f64::INFINITY;3];let mut high=[f64::NEG_INFINITY;3];
    for &id in slice.iter(){for a in 0..3{low[a]=low[a].min(centres[id][a]);high[a]=high[a].max(centres[id][a]);}}
    let mut axis=0;for a in 1..3{if high[a]-low[a]>high[axis]-low[axis]{axis=a;}}
    slice.sort_unstable_by(|&x,&y|centres[x][axis].total_cmp(&centres[y][axis]).then(x.cmp(&y)));
    let middle=from+(to-from)/2;
    next.push((from,middle));next.push((middle,to));
   }
   ranges=next;
  }
  let ranges:Vec<(usize,usize)>=ranges.into_iter().filter(|(from,to)|to>from).collect();
  let first_child=nodes.len();
  nodes[index].first_child=first_child;nodes[index].child_count=ranges.len();
  nodes.resize(first_child+ranges.len(),CullingNode::default());
  for (offset,(from,to)) in ranges.into_iter().enumerate(){queue.push_back((first_child+offset,from,to));}
 }
 (order,nodes)
}
#[cfg(test)] mod tests{
 use super::*;
 use std::collections::{HashMap,HashSet};

 /// Displaced grid: a manifold sheet with enough detail that simplification has work to do.
 pub(crate) fn grid(n:usize)->(Vec<f32>,Vec<u32>){
  let w=n+1;
  let mut positions=Vec::with_capacity(w*w*3);
  for y in 0..w{for x in 0..w{
   let fx=x as f32;let fy=y as f32;
   positions.extend([fx,fy,(fx*0.31).sin()*(fy*0.27).cos()*2.0]);
  }}
  let mut indices=Vec::with_capacity(n*n*6);
  for y in 0..n as u32{for x in 0..n as u32{
   let a=y*w as u32+x;
   indices.extend([a,a+1,a+w as u32,a+1,a+1+w as u32,a+w as u32]);
  }}
  (positions,indices)
 }

 fn build(n:usize)->(Vec<f32>,Vec<u32>,Vec<DagCluster>){
  let (positions,indices)=grid(n);
  let (dag,_,_)=build_dag_tallied(&positions,&indices,&||Ok(())).expect("dag");
  (positions,indices,dag)
 }

 #[test] fn level_zero_clusters_respect_the_triangle_budget_and_cover_the_source_once(){
  let (_,indices,dag)=build(160); // 51 200 triangles
  let leaves:Vec<&DagCluster>=dag.iter().filter(|c|c.level==0).collect();
  assert!(leaves.len()>1);
  for cluster in &leaves{
   assert!(cluster.triangles()<=DAG_CLUSTER_TRIANGLES,"cluster of {} triangles",cluster.triangles());
   assert!(cluster.triangles()>0);
  }
  let key=|tri:&[u32]|{let mut t=[tri[0],tri[1],tri[2]];t.sort_unstable();t};
  let mut from_source:HashMap<[u32;3],usize>=HashMap::new();
  for tri in indices.chunks_exact(3){*from_source.entry(key(tri)).or_insert(0)+=1;}
  let mut from_dag:HashMap<[u32;3],usize>=HashMap::new();
  for cluster in &leaves{for tri in cluster.indices.chunks_exact(3){*from_dag.entry(key(tri)).or_insert(0)+=1;}}
  assert_eq!(from_dag,from_source,"level 0 must cover every source triangle exactly once");
 }

 #[test] fn every_level_above_zero_uses_groups_of_eight_to_thirty_two_clusters(){
  // Grouping is exercised directly: the builder feeds it the live cluster graph each level.
  let (positions,indices)=grid(160);
  let clusters=cluster_triangles(&positions,&indices,DAG_CLUSTER_TRIANGLES).expect("clusters");
  let lists:Vec<&[u32]>=clusters.iter().map(|c|c.as_slice()).collect();
  let adjacency=cluster_adjacency(&lists);
  let centres:Vec<[f64;3]>=clusters.iter().map(|c|{let s=bounding_sphere(&positions,c);[s[0],s[1],s[2]]}).collect();
  let groups=group_clusters(&centres,&adjacency,DAG_GROUP_MAX);
  assert!(groups.len()>1);
  let mut seen=vec![false;clusters.len()];
  for group in &groups{
   assert!(group.len()<=DAG_GROUP_MAX,"group of {}",group.len());
   assert!(group.len()>=DAG_GROUP_MIN||groups.len()==1,"group of {}",group.len());
   for &member in group{assert!(!seen[member],"cluster in two groups");seen[member]=true;}
  }
  assert!(seen.into_iter().all(|v|v),"every cluster belongs to a group");
 }

 #[test] fn errors_are_monotone_and_roots_are_terminal(){
  let (_,_,dag)=build(160);
  let mut roots=0;
  for cluster in &dag{
   assert!(cluster.lod_error>=0.0&&cluster.lod_error.is_finite());
   assert!(cluster.parent_error>=cluster.lod_error,"parent {} < lod {}",cluster.parent_error,cluster.lod_error);
   if cluster.level==0{assert_eq!(cluster.lod_error,0.0);}
   if cluster.is_root(){roots+=1;}
   // The parent bounds must enclose the cluster's own bounds, so the projected error is monotone too.
   if cluster.parent_error.is_finite(){
    let d=((cluster.sphere[0]-cluster.parent_sphere[0]).powi(2)+(cluster.sphere[1]-cluster.parent_sphere[1]).powi(2)+(cluster.sphere[2]-cluster.parent_sphere[2]).powi(2)).sqrt();
    assert!(d+cluster.sphere[3]<=cluster.parent_sphere[3]+1e-6,"parent sphere must enclose the child sphere");
   }
  }
  assert!(roots>=1);
  assert!(dag.iter().any(|c|c.level>0),"the DAG must have at least one coarse level");
 }

 #[test] fn every_threshold_selects_exactly_one_cluster_per_ancestor_chain(){
  let (_,_,dag)=build(160);
  // Projected error at a fixed eye: monotone in the stored object error and in the sphere radius.
  let project=|error:f64,sphere:[f64;4]|->f64{
   if !(error>0.0){return 0.0;}
   if !error.is_finite(){return f64::INFINITY;}
   let distance=(sphere[0]*sphere[0]+sphere[1]*sphere[1]+(sphere[2]-4000.0).powi(2)).sqrt()-sphere[3];
   if distance<=1.0{return f64::INFINITY;}
   error*600.0/distance
  };
  for &threshold in &[0.0_f64,0.25,1.0,4.0,64.0,1e9]{
   let drawn=|c:&DagCluster|project(c.lod_error,c.sphere)<=threshold&&project(c.parent_error,c.parent_sphere)>threshold;
   for (id,leaf) in dag.iter().enumerate(){
    if leaf.level!=0{continue;}
    let mut node=id;
    let mut hops=0;
    let mut selected=0;
    loop{
     if drawn(&dag[node]){selected+=1;}
     let Some(next)=dag[node].replacement else{break};
     node=next;hops+=1;
     assert!(hops<=DAG_MAX_LEVELS,"chain must terminate");
    }
    assert!(dag[node].is_root(),"a chain must end on a root");
    assert_eq!(selected,1,"threshold {threshold}: chain from cluster {id} selected {selected} clusters");
   }
  }
 }

 #[test] fn group_simplification_pins_shared_vertices_and_frees_the_open_boundary(){
  let (positions,indices)=grid(64);
  let clusters=cluster_triangles(&positions,&indices,DAG_CLUSTER_TRIANGLES).expect("clusters");
  let lists:Vec<&[u32]>=clusters.iter().map(|c|c.as_slice()).collect();
  let adjacency=cluster_adjacency(&lists);
  let centres:Vec<[f64;3]>=clusters.iter().map(|c|{let s=bounding_sphere(&positions,c);[s[0],s[1],s[2]]}).collect();
  let groups=group_clusters(&centres,&adjacency,DAG_GROUP_MAX);
  assert!(groups.len()>1,"the test needs at least two groups for a shared seam");
  let weld=weld_positions(&positions,&indices);
  let locks=level_locks(&weld,&lists,&groups);
  assert!(locks.iter().any(|&locked|locked),"neighbouring groups must share vertices");
  // The sheet's own open boundary must stay free: a corner vertex used by one group only.
  let corner=indices[0];
  let corner_groups=groups.iter().filter(|group|group.iter().any(|&slot|lists[slot].contains(&corner))).count();
  if corner_groups==1{assert!(!locks[corner as usize],"a vertex owned by a single group must stay free");}

  let children:Vec<DagCluster>=clusters.iter().enumerate().map(|(i,indices)|{
   let sphere=bounding_sphere(&positions,indices);
   DagCluster{indices:indices.clone(),level:0,lod_error:0.0,parent_error:f64::INFINITY,sphere,parent_sphere:sphere,replacement:None,source_rank:i as u32,group:None,source:None}
  }).collect();
  let group:Vec<&DagCluster>=groups[0].iter().map(|&slot|&children[slot]).collect();
  let merged:Vec<u32>=group.iter().flat_map(|c|c.indices.iter().copied()).collect();
  let input=GroupReductionInput{positions:&positions,locks:&locks,weld:&weld};
  let reduction=reduce_group(&input,&group).expect("reduce").expect("group must simplify");
  assert!(reduction.error>0.0);
  let produced:usize=reduction.clusters.iter().map(|c|c.len()/3).sum();
  assert!(produced<merged.len()/3);
  for cluster in &reduction.clusters{assert!(cluster.len()/3<=DAG_CLUSTER_TRIANGLES);}
  let kept:HashSet<u32>=reduction.clusters.iter().flat_map(|c|c.iter()).map(|&id|weld[id as usize]).collect();
  for &id in &merged{
   if locks[id as usize]{assert!(kept.contains(&weld[id as usize]),"a vertex shared with another group was dropped: crack");}
  }
 }

 #[test] fn an_isolated_sheet_simplifies_its_whole_boundary(){
  // One group covering everything: nothing is shared, so nothing is locked and the outline moves.
  let (positions,indices)=grid(16);
  let clusters=cluster_triangles(&positions,&indices,DAG_CLUSTER_TRIANGLES).expect("clusters");
  let lists:Vec<&[u32]>=clusters.iter().map(|c|c.as_slice()).collect();
  let groups=vec![(0..clusters.len()).collect::<Vec<_>>()];
  let weld=weld_positions(&positions,&indices);
  let locks=level_locks(&weld,&lists,&groups);
  assert!(locks.iter().all(|&locked|!locked),"a single group locks nothing");
  let children:Vec<DagCluster>=clusters.iter().map(|indices|{
   let sphere=bounding_sphere(&positions,indices);
   DagCluster{indices:indices.clone(),level:0,lod_error:0.0,parent_error:f64::INFINITY,sphere,parent_sphere:sphere,replacement:None,source_rank:0,group:None,source:None}
  }).collect();
  let group:Vec<&DagCluster>=children.iter().collect();
  let input=GroupReductionInput{positions:&positions,locks:&locks,weld:&weld};
  let reduction=reduce_group(&input,&group).expect("reduce").expect("an unlocked sheet must simplify");
  let produced:usize=reduction.clusters.iter().map(|c|c.len()/3).sum();
  assert!(produced<=indices.len()/6,"an unlocked sheet must reach the 50% target, got {produced}");
 }

 #[test] fn every_group_owns_its_children_and_its_coarse_replacement(){
  let (positions,indices)=grid(160);
  let (dag,groups,_)=build_dag_tallied(&positions,&indices,&||Ok(())).expect("dag");
  assert!(!groups.is_empty());
  let mut owned=vec![0usize;dag.len()];
  let mut produced=vec![0usize;dag.len()];
  for (index,group) in groups.iter().enumerate(){
   assert!(!group.children.is_empty()&&!group.outputs.is_empty());
   for &child in &group.children{
    owned[child]+=1;
    assert_eq!(dag[child].group,Some(index),"a cluster must name the group that replaces it");
    assert_eq!(dag[child].parent_error,group.error);
    assert_eq!(dag[child].parent_sphere,group.sphere);
   }
   for &output in &group.outputs{
    produced[output]+=1;
    assert_eq!(dag[output].lod_error,group.error,"an output carries the error of the group that made it");
    assert_eq!(dag[output].sphere,group.sphere);
    assert_eq!(dag[output].level,group.level);
    assert_eq!(dag[output].source,Some(index),"an output must name the group that made it");
   }
  }
  for (index,cluster) in dag.iter().enumerate(){
   assert_eq!(owned[index],if cluster.is_root(){0}else{1},"a cluster belongs to exactly one group unless it is a root");
   assert!(produced[index]<=1,"a cluster is produced by at most one group");
   assert_eq!(produced[index]==0,cluster.level==0,"only level 0 has no producing group");
  }
 }

 #[test] fn a_group_and_its_replacement_cover_the_same_triangles_once(){
  // Fallback safety: swapping a group's children for its outputs must not leave or duplicate area.
  let (positions,indices)=grid(160);
  let (dag,groups,_)=build_dag_tallied(&positions,&indices,&||Ok(())).expect("dag");
  let area=|ids:&[u32]|->f64{
   ids.chunks_exact(3).map(|tri|{
    let p=|id:u32|{let i=id as usize*3;[positions[i] as f64,positions[i+1] as f64,positions[i+2] as f64]};
    let (a,b,c)=(p(tri[0]),p(tri[1]),p(tri[2]));
    let u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];let v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    (n[0]*n[0]+n[1]*n[1]+n[2]*n[2]).sqrt()/2.0
   }).sum()
  };
  for group in &groups{
   let fine:f64=group.children.iter().map(|&id|area(&dag[id].indices)).sum();
   let coarse:f64=group.outputs.iter().map(|&id|area(&dag[id].indices)).sum();
   assert!(fine>0.0&&coarse>0.0);
   // A planar-ish sheet keeps its area; a curved one loses a little to the flattening.
   assert!(coarse<=fine*1.05&&coarse>=fine*0.80,"group area {fine} became {coarse}");
  }
 }

 #[test] fn a_planar_sheet_keeps_its_exact_level_and_coarsens_without_error(){
  // A plane simplifies losslessly, so every level shares error zero; level 0 must still be emitted.
  let w=65usize;
  let positions:Vec<f32>=(0..w).flat_map(|y|(0..w).flat_map(move |x|[x as f32,y as f32,0.0])).collect();
  let mut indices=Vec::new();
  for y in 0..(w-1) as u32{for x in 0..(w-1) as u32{let a=y*w as u32+x;indices.extend([a,a+1,a+w as u32,a+1,a+1+w as u32,a+w as u32]);}}
  let (dag,_,_)=build_dag_tallied(&positions,&indices,&||Ok(())).expect("dag");
  let leaves:usize=dag.iter().filter(|c|c.level==0).map(|c|c.triangles()).sum();
  assert_eq!(leaves,indices.len()/3,"level 0 must keep the exact cover even when every error is zero");
  assert!(dag.iter().any(|c|c.level>0),"a plane must still coarsen");
  assert!(dag.iter().all(|c|c.lod_error==0.0||!c.lod_error.is_finite()));
 }

 #[test] fn build_honours_cancellation(){
  let (positions,indices)=grid(32);
  let error=build_dag_tallied(&positions,&indices,&||Err(invalid("cancelled"))).err().expect("cancelled");
  assert!(error.to_string().contains("cancelled"));
 }

 #[test] fn the_culling_hierarchy_owns_every_cluster_once_and_bounds_its_subtree(){
  let (positions,_,dag)=build(160);
  let (order,nodes)=build_culling_bvh(&positions,&dag);
  assert_eq!(order.len(),dag.len());
  let mut sorted=order.clone();sorted.sort_unstable();
  assert_eq!(sorted,(0..dag.len()).collect::<Vec<_>>(),"the order must be a permutation");
  assert!(nodes.len()>1,"a large DAG must produce interior nodes");
  let mut covered=vec![0usize;dag.len()];
  for (index,node) in nodes.iter().enumerate(){
   // The root fans out over the levels; every spatial node stays within the branching factor.
   assert!(node.child_count<=CULLING_BRANCHING||index==0);
   if node.child_count==0{
    assert!(node.cluster_count>0&&node.cluster_count<=CULLING_LEAF);
    for slot in node.first_cluster..node.first_cluster+node.cluster_count{covered[order[slot]]+=1;}
   }else{
    assert_eq!(node.cluster_count,0);
    assert!(node.first_child+node.child_count<=nodes.len());
   }
  }
  assert!(covered.iter().all(|&n|n==1),"every cluster belongs to exactly one leaf");
  // Each node must bound its whole subtree: box, sphere and error.
  fn check(nodes:&[CullingNode],order:&[usize],dag:&[DagCluster],positions:&[f32],index:usize){
   let node=&nodes[index];
   let leaves:Vec<usize>=if node.child_count==0{
    order[node.first_cluster..node.first_cluster+node.cluster_count].to_vec()
   }else{
    let mut all=Vec::new();
    for child in node.first_child..node.first_child+node.child_count{
     check(nodes,order,dag,positions,child);
     let c=&nodes[child];
     for a in 0..3{assert!(c.min[a]>=node.min[a]-1e-6&&c.max[a]<=node.max[a]+1e-6);}
     all.extend(subtree(nodes,order,child));
    }
    all
   };
   for &id in &leaves{
    let cluster=&dag[id];
    let (bmin,bmax)=cluster_bounds(positions,&cluster.indices);
    for a in 0..3{assert!(bmin[a]>=node.min[a]-1e-6&&bmax[a]<=node.max[a]+1e-6,"cluster outside its node box");}
    assert!(cluster.parent_error<=node.max_parent_error,"parent error above the node bound");
    let s=cluster.parent_sphere;let n=node.sphere;
    let d=((s[0]-n[0]).powi(2)+(s[1]-n[1]).powi(2)+(s[2]-n[2]).powi(2)).sqrt();
    assert!(d+s[3]<=n[3]+1e-6,"parent sphere outside the node sphere");
   }
  }
  fn subtree(nodes:&[CullingNode],order:&[usize],index:usize)->Vec<usize>{
   let node=&nodes[index];
   if node.child_count==0{return order[node.first_cluster..node.first_cluster+node.cluster_count].to_vec();}
   (node.first_child..node.first_child+node.child_count).flat_map(|child|subtree(nodes,order,child)).collect()
  }
  check(&nodes,&order,&dag,&positions,0);
 }

 #[test] fn enclosing_sphere_contains_every_input(){
  let spheres=[[0.0,0.0,0.0,1.0],[5.0,0.0,0.0,2.0],[0.0,-3.0,1.0,0.5]];
  let result=enclosing_sphere(&spheres);
  for sphere in spheres{
   let d=((sphere[0]-result[0]).powi(2)+(sphere[1]-result[1]).powi(2)+(sphere[2]-result[2]).powi(2)).sqrt();
   assert!(d+sphere[3]<=result[3]+1e-9);
  }
 }
}
