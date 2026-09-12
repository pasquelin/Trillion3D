function edgeKey(a,b){return a<b?`${a},${b}`:`${b},${a}`;}
function addLinkEdge(adj,a,b){
 if(a===b)return;
 if(!adj.has(a))adj.set(a,new Set());
 if(!adj.has(b))adj.set(b,new Set());
 adj.get(a).add(b);adj.get(b).add(a);
}
function componentCount(adj){
 const seen=new Set();let count=0;
 for(const start of adj.keys()){
  if(seen.has(start))continue;
  count++;
  const stack=[start];
  while(stack.length){
   const node=stack.pop();
   if(seen.has(node))continue;
   seen.add(node);
   for(const next of adj.get(node)??[])if(!seen.has(next))stack.push(next);
  }
 }
 return count;
}
function classifyVertexLink(adj){
 if(adj.size===0)return 'locked';
 let degreeOne=0,degreeTwo=0;
 for(const neighbours of adj.values()){
  const degree=neighbours.size;
  if(degree===1)degreeOne++;
  else if(degree===2)degreeTwo++;
  else return 'locked';
 }
 if(componentCount(adj)!==1)return 'locked';
 if(degreeOne===0&&degreeTwo===adj.size)return 'interior';
 if(degreeOne===2&&degreeTwo===adj.size-2)return 'boundary';
 return 'locked';
}
/** Half-edge classification. Does not repair topology. Vertex count is the POSITION accessor length. */
export function classifyTopology(indices,vertexCount){
 if(!Number.isSafeInteger(vertexCount)||vertexCount<0)throw new Error('vertexCount is required');
 if(!Array.isArray(indices)&&!(indices instanceof Uint32Array)&&!(indices instanceof Uint16Array))throw new Error('indices are required');
 if(indices.length%3!==0)throw new Error('Index count must be a positive multiple of three');
 const edges=new Map();
 const links=Array.from({length:vertexCount},()=>new Map());
 const incident=new Uint32Array(vertexCount);
 for(let face=0,offset=0;offset<indices.length;face++,offset+=3){
  const tri=[Number(indices[offset]),Number(indices[offset+1]),Number(indices[offset+2])];
  for(const vertex of tri)if(!Number.isInteger(vertex)||vertex<0||vertex>=vertexCount)throw new Error('Invalid index');
  for(let e=0;e<3;e++){
   const start=tri[e],end=tri[(e+1)%3];
   const key=edgeKey(start,end);
   if(!edges.has(key))edges.set(key,[]);
   edges.get(key).push({start,end,face});
   incident[start]++;
   addLinkEdge(links[start],end,tri[(e+2)%3]);
  }
 }
 let boundary=0,manifold=0,nonManifold=0;
 const neighbors=Array.from({length:indices.length/3},()=>new Set());
 for(const occurrences of edges.values()){
  if(occurrences.length===1)boundary++;
  else if(occurrences.length===2&&occurrences[0].start===occurrences[1].end&&occurrences[0].end===occurrences[1].start){
   manifold++;
   neighbors[occurrences[0].face].add(occurrences[1].face);
   neighbors[occurrences[1].face].add(occurrences[0].face);
  }else nonManifold++;
 }
 let interior=0,boundaryVertices=0,locked=0,unused=0;
 for(let vertex=0;vertex<vertexCount;vertex++){
  if(incident[vertex]===0){unused++;continue;}
  const kind=classifyVertexLink(links[vertex]);
  if(kind==='interior')interior++;
  else if(kind==='boundary')boundaryVertices++;
  else locked++;
 }
 return {
  triangles:indices.length/3,
  edges:{boundary,manifold,nonManifold},
  vertices:{interior,boundary:boundaryVertices,locked,unused},
  neighbors:neighbors.map(set=>[...set].sort((a,b)=>a-b)),
  manifold:nonManifold===0&&locked===0,
 };
}
