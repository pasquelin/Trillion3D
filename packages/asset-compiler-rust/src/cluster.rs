use crate::{invalid,Result,CLUSTER_TRIANGLES,ClusterStrategy};
pub struct GreedyAdjacency;
impl ClusterStrategy for GreedyAdjacency {
 fn id(&self)->&str{"greedy-adjacency"}
 fn version(&self)->u32{1}
 fn clusters(&self,indices:&[u32],neighbors:&[Vec<usize>])->Result<Vec<Vec<usize>>>{greedy_clusters(indices,neighbors,CLUSTER_TRIANGLES,CLUSTER_TRIANGLES)}
}
pub fn greedy_clusters(indices:&[u32],neighbors:&[Vec<usize>],max_triangles:usize,max_vertices:usize)->Result<Vec<Vec<usize>>>{
 if indices.len()%3!=0||indices.is_empty(){return Err(invalid("Index count must be a positive multiple of three"));}
 if max_triangles==0||max_vertices<3{return Err(invalid("Cluster budgets must be positive"));}
 let triangle_count=indices.len()/3;
 let mut assigned=vec![false;triangle_count];
 let mut queued=vec![false;triangle_count];
 let mut clusters=Vec::new();
 let mut next=0usize;
 while next<triangle_count{
  while next<triangle_count&&assigned[next]{next+=1;}
  if next>=triangle_count{break;}
  let mut cluster=Vec::new();
  let mut vertices=std::collections::HashSet::new();
  let add=|triangle:usize,cluster:&mut Vec<usize>,vertices:&mut std::collections::HashSet<u32>,assigned:&mut [bool]|{
   assigned[triangle]=true;cluster.push(triangle);
   vertices.insert(indices[triangle*3]);vertices.insert(indices[triangle*3+1]);vertices.insert(indices[triangle*3+2]);
  };
  let mut frontier=Vec::new();
  let enqueue=|triangle:usize,assigned:&[bool],queued:&mut [bool],frontier:&mut Vec<usize>|{
   for &neighbour in neighbors.get(triangle).map(|v|v.as_slice()).unwrap_or(&[]){
    if assigned[neighbour]||queued[neighbour]{continue;}
    queued[neighbour]=true;frontier.push(neighbour);
   }
  };
  add(next,&mut cluster,&mut vertices,&mut assigned);
  enqueue(next,&assigned,&mut queued,&mut frontier);
  while cluster.len()<max_triangles{
   let mut best:Option<usize>=None;let mut best_new=usize::MAX;let mut keep=0usize;
   for read in 0..frontier.len(){
    let neighbour=frontier[read];
    if assigned[neighbour]{queued[neighbour]=false;continue;}
    frontier[keep]=neighbour;keep+=1;
    let a=indices[neighbour*3];let b=indices[neighbour*3+1];let c=indices[neighbour*3+2];
    let added=(if vertices.contains(&a){0}else{1})+(if vertices.contains(&b){0}else{1})+(if vertices.contains(&c){0}else{1});
    if vertices.len()+added>max_vertices{continue;}
    if added<best_new||(added==best_new&&best.map(|v|neighbour<v).unwrap_or(true)){best=Some(neighbour);best_new=added;}
   }
   frontier.truncate(keep);
   match best{Some(triangle)=>{add(triangle,&mut cluster,&mut vertices,&mut assigned);enqueue(triangle,&assigned,&mut queued,&mut frontier);},None=>break}
  }
  for &neighbour in &frontier{queued[neighbour]=false;}
  clusters.push(cluster);
 }
 Ok(clusters)
}
#[cfg(test)] mod tests{
 use super::*;
 use crate::topology::classify_topology;
 #[test] fn greedy_covers_a_manifold_strip(){
  let mut indices=Vec::new();
  for i in 0..6u32{
   if i%2==0{indices.extend([i,i+1,i+2]);}else{indices.extend([i+1,i,i+2]);}
  }
  let topology=classify_topology(&indices,8).expect("topology");
  let clusters=greedy_clusters(&indices,&topology.neighbors,2,8).expect("clusters");
  let mut covered:Vec<usize>=clusters.iter().flatten().copied().collect();covered.sort_unstable();
  assert_eq!(covered,vec![0,1,2,3,4,5]);
  assert!(clusters.iter().all(|c|c.len()<=2));
 }
 #[test] fn greedy_frontier_covers_a_long_strip_once(){
  let mut indices=Vec::new();
  for i in 0..64u32{
   if i%2==0{indices.extend([i,i+1,i+2]);}else{indices.extend([i+1,i,i+2]);}
  }
  let topology=classify_topology(&indices,66).expect("topology");
  let clusters=greedy_clusters(&indices,&topology.neighbors,8,16).expect("clusters");
  let mut covered:Vec<usize>=clusters.iter().flatten().copied().collect();covered.sort_unstable();
  assert_eq!(covered,(0..64).collect::<Vec<_>>());
  assert!(clusters.iter().all(|c|c.len()<=8));
 }
}
