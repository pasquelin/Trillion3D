const DEFAULT_TRIANGLES=256;
export function exactClusters(indexCount,maxTriangles=DEFAULT_TRIANGLES){
 if(!Number.isSafeInteger(indexCount)||indexCount<3||indexCount%3!==0)throw new Error('Index count must be a positive multiple of three');
 const triangles=indexCount/3,clusters=[];
 for(let start=0;start<triangles;start+=maxTriangles)clusters.push(Array.from({length:Math.min(maxTriangles,triangles-start)},(_,i)=>start+i));
 return clusters;
}
export function greedyClusters(indices,neighbors,{maxTriangles=DEFAULT_TRIANGLES,maxVertices=DEFAULT_TRIANGLES}={}){
 const triangleCount=indices.length/3;
 if(triangleCount===0||indices.length%3!==0)throw new Error('Index count must be a positive multiple of three');
 if(!Number.isSafeInteger(maxTriangles)||maxTriangles<1||!Number.isSafeInteger(maxVertices)||maxVertices<3)throw new Error('Cluster budgets must be positive');
 const assigned=new Uint8Array(triangleCount),queued=new Uint8Array(triangleCount),clusters=[];
 let next=0;
 while(next<triangleCount){
  while(next<triangleCount&&assigned[next])next++;
  if(next>=triangleCount)break;
  const cluster=[],vertices=new Set(),frontier=[];
  const add=triangle=>{
   assigned[triangle]=1;cluster.push(triangle);
   vertices.add(indices[triangle*3]);vertices.add(indices[triangle*3+1]);vertices.add(indices[triangle*3+2]);
  };
  const enqueue=triangle=>{
   for(const neighbour of neighbors[triangle]??[]){
    if(assigned[neighbour]||queued[neighbour])continue;
    queued[neighbour]=1;frontier.push(neighbour);
   }
  };
  add(next);enqueue(next);
  while(cluster.length<maxTriangles){
   let best=-1,bestNew=Infinity,keep=0;
   for(let read=0;read<frontier.length;read++){
    const neighbour=frontier[read];
    if(assigned[neighbour]){queued[neighbour]=0;continue;}
    frontier[keep++]=neighbour;
    const a=indices[neighbour*3],b=indices[neighbour*3+1],c=indices[neighbour*3+2];
    const added=(vertices.has(a)?0:1)+(vertices.has(b)?0:1)+(vertices.has(c)?0:1);
    if(vertices.size+added>maxVertices)continue;
    if(added<bestNew||(added===bestNew&&(best<0||neighbour<best))){best=neighbour;bestNew=added;}
   }
   frontier.length=keep;
   if(best<0)break;
   add(best);enqueue(best);
  }
  for(const neighbour of frontier)queued[neighbour]=0;
  clusters.push(cluster);
 }
 return clusters;
}
