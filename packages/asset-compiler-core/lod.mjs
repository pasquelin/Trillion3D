import {simplifyToEndpoints} from './qem.mjs';

export function triangleBounds(triangleIds,indices,positions){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const triangle of triangleIds){
  for(let k=0;k<3;k++){
   const index=indices[triangle*3+k];
   for(let axis=0;axis<3;axis++){
    const value=positions[index*3+axis];
    if(value<min[axis])min[axis]=value;
    if(value>max[axis])max[axis]=value;
   }
  }
 }
 return {min,max};
}
export function flattenTriangles(triangleIds,indices){
 const out=[];
 for(const triangle of triangleIds)for(let k=0;k<3;k++)out.push(indices[triangle*3+k]);
 return out;
}
export function clusterAdjacency(clusters,triangleNeighbors){
 const clusterOf=new Array(triangleNeighbors.length).fill(-1);
 clusters.forEach((triangles,id)=>{for(const triangle of triangles)clusterOf[triangle]=id;});
 return clusters.map((triangles,id)=>{
  const next=new Set();
  for(const triangle of triangles)for(const neighbour of triangleNeighbors[triangle]??[]){
   const other=clusterOf[neighbour];
   if(other>=0&&other!==id)next.add(other);
  }
  return [...next].sort((a,b)=>a-b);
 });
}
function descendantClusters(region){
 if(region.type==='leaf')return [region.clusterIndex];
 return region.children.flatMap(descendantClusters);
}
function regionAdjacency(regions,clusterAdj){
 const members=regions.map(descendantClusters);
 const clusterToRegion=new Array(clusterAdj.length).fill(-1);
 for(let i=0;i<members.length;i++)for(const cluster of members[i]){
  if(cluster>=clusterToRegion.length)clusterToRegion.length=cluster+1;
  clusterToRegion[cluster]=i;
 }
 return members.map((clusters,i)=>{
  const next=new Set();
  for(const cluster of clusters)for(const other of clusterAdj[cluster]??[]){
   const region=clusterToRegion[other]??-1;
   if(region>=0&&region!==i)next.add(region);
  }
  return [...next].sort((a,b)=>a-b);
 });
}
function pairRegions(count,adjacency){
 const used=new Uint8Array(count),pairs=[];
 for(let i=0;i<count;i++){
  if(used[i])continue;
  let best=-1;
  for(const j of adjacency[i])if(!used[j]&&j!==i&&(best<0||j<best))best=j;
  used[i]=1;
  if(best<0)pairs.push([i]);
  else{used[best]=1;pairs.push([i,best].sort((a,b)=>a-b));}
 }
 return pairs;
}
function unionBounds(a,b){
 return {min:[Math.min(a.min[0],b.min[0]),Math.min(a.min[1],b.min[1]),Math.min(a.min[2],b.min[2])],max:[Math.max(a.max[0],b.max[0]),Math.max(a.max[1],b.max[1]),Math.max(a.max[2],b.max[2])]};
}
function meshOf(node,indices){
 if(node.type==='leaf')return flattenTriangles(node.triangles,indices);
 return (node.mesh??node.coarseIndices??[]).slice();
}
/** Nested replacement regions: pair neighbours, unlock shared borders, simplify the union. */
function combineRegions(regions){
 while(regions.length>1){
  const next=[];
  const min=[Infinity,Infinity,Infinity];
  const max=[-Infinity,-Infinity,-Infinity];
  for(const node of regions){
   for(let a=0;a<3;a++){
    min[a]=Math.min(min[a],node.min[a]);
    max[a]=Math.max(max[a],node.max[a]);
   }
  }
  let axis=0;
  for(let a=1;a<3;a++){
   if(max[a]-min[a]>max[axis]-min[axis])axis=a;
  }
  regions.sort((a,b)=>{
   const ca=a.min[axis]+a.max[axis];
   const cb=b.min[axis]+b.max[axis];
   return ca-cb;
  });
  for(let i=0;i<regions.length;i+=2){
   if(i+1<regions.length){
    const left=regions[i],right=regions[i+1];
    const {min:umin,max:umax}=unionBounds(left,right);
    next.push({
     type:'node',
     children:[left,right],
     triangles:[],
     mesh:[],
     reduced:false,
     coarseIndices:[],
     errorObject:Math.max(left.errorObject??0,right.errorObject??0),
     min:umin,
     max:umax,
    });
   }else{
    next.push(regions[i]);
   }
  }
  regions=next;
 }
 return regions[0];
}
export function buildLodTree(positions,indices,clusters,triangleNeighbors){
 if(!clusters.length)return null;
 const clusterAdj=clusterAdjacency(clusters,triangleNeighbors);
 let regions=clusters.map((triangles,clusterIndex)=>{
  const {min,max}=triangleBounds(triangles,indices,positions);
  return {type:'leaf',clusterIndex,triangles,min,max,errorObject:0};
 });
 let adjacency=clusterAdj;
 while(regions.length>1){
  const pairs=pairRegions(regions.length,adjacency);
  if(pairs.every(pair=>pair.length===1))break;
  const next=[];
  for(const pair of pairs){
   if(pair.length===1){next.push(regions[pair[0]]);continue;}
   const left=regions[pair[0]],right=regions[pair[1]];
   const indexList=meshOf(left,indices).concat(meshOf(right,indices));
   const simplified=simplifyToEndpoints(positions,indexList,{targetTriangles:Math.max(1,Math.floor(indexList.length/6))});
   const progressed=simplified.triangles<indexList.length/3;
   const {min,max}=unionBounds(left,right);
   next.push({
    type:'node',
    children:[left,right],
    triangles:[],
    mesh:progressed?simplified.indices:indexList,
    reduced:progressed,
    coarseIndices:progressed?simplified.indices:[],
    errorObject:progressed?Math.max(simplified.errorObject,left.errorObject??0,right.errorObject??0):Math.max(left.errorObject??0,right.errorObject??0),
    min,max,
   });
  }
  if(next.length>=regions.length)break;
  adjacency=regionAdjacency(next,clusterAdj);
  regions=next;
 }
 if(!regions.length)return null;
 if(regions.length===1)return regions[0];
 return combineRegions(regions);
}
