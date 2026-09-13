import {classifyTopology} from './topology.mjs';

function positionOf(positions,index){return [positions[index*3],positions[index*3+1],positions[index*3+2]];}
function planeOf(p0,p1,p2){
 const n=[(p1[1]-p0[1])*(p2[2]-p0[2])-(p1[2]-p0[2])*(p2[1]-p0[1]),(p1[2]-p0[2])*(p2[0]-p0[0])-(p1[0]-p0[0])*(p2[2]-p0[2]),(p1[0]-p0[0])*(p2[1]-p0[1])-(p1[1]-p0[1])*(p2[0]-p0[0])];
 const len=Math.hypot(n[0],n[1],n[2]);if(!(len>0))return null;
 return [n[0]/len,n[1]/len,n[2]/len,-(n[0]/len*p0[0]+n[1]/len*p0[1]+n[2]/len*p0[2])];
}
function emptyQuadric(){return [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];}
function addPlane(Q,plane,weight=1){for(let r=0;r<4;r++)for(let c=0;c<4;c++)Q[r][c]+=weight*plane[r]*plane[c];}
function addQuadrics(left,right){const Q=emptyQuadric();for(let r=0;r<4;r++)for(let c=0;c<4;c++)Q[r][c]=left[r][c]+right[r][c];return Q;}
function energy(Q,point){
 const x=point[0],y=point[1],z=point[2];
 const q0=Q[0],q1=Q[1],q2=Q[2],q3=Q[3];
 return x*(x*q0[0]+y*q0[1]+z*q0[2]+q0[3])+y*(x*q1[0]+y*q1[1]+z*q1[2]+q1[3])+z*(x*q2[0]+y*q2[1]+z*q2[2]+q2[3])+(x*q3[0]+y*q3[1]+z*q3[2]+q3[3]);
}
function linkCondition(vFaces,faces,left,right){
 const facesLeft=vFaces[left],facesRight=vFaces[right];
 if(!facesLeft||!facesRight||facesLeft.length===0||facesRight.length===0)return false;
 const linkLeft=new Set();
 for(let i=0;i<facesLeft.length;i++){
  const tri=faces[facesLeft[i]],t0=tri[0],t1=tri[1],t2=tri[2];
  let r0,r1;
  if(t0===left){r0=t1;r1=t2;}else if(t1===left){r0=t0;r1=t2;}else{r0=t0;r1=t1;}
  if(r0===r1)linkLeft.add(String(r0));
  else{
   if(r0>r1){const tmp=r0;r0=r1;r1=tmp;}
   linkLeft.add(String(r0));linkLeft.add(String(r1));linkLeft.add(`${r0},${r1}`);
  }
 }
 const linkRight=new Set();
 for(let i=0;i<facesRight.length;i++){
  const tri=faces[facesRight[i]],t0=tri[0],t1=tri[1],t2=tri[2];
  let r0,r1;
  if(t0===right){r0=t1;r1=t2;}else if(t1===right){r0=t0;r1=t2;}else{r0=t0;r1=t1;}
  if(r0===r1)linkRight.add(String(r0));
  else{
   if(r0>r1){const tmp=r0;r0=r1;r1=tmp;}
   linkRight.add(String(r0));linkRight.add(String(r1));linkRight.add(`${r0},${r1}`);
  }
 }
 const linkEdge=new Set();
 for(let i=0;i<facesLeft.length;i++){
  const tri=faces[facesLeft[i]],t0=tri[0],t1=tri[1],t2=tri[2];
  if((t0===left&&t1===right)||(t0===right&&t1===left))linkEdge.add(String(t2));
  else if((t0===left&&t2===right)||(t0===right&&t2===left))linkEdge.add(String(t1));
  else if((t1===left&&t2===right)||(t1===right&&t2===left))linkEdge.add(String(t0));
 }
 if(linkLeft.size===0||linkRight.size===0)return false;
 let intersection=0;
 for(const item of linkLeft)if(linkRight.has(item))intersection++;
 if(intersection!==linkEdge.size)return false;
 for(const item of linkEdge)if(!linkLeft.has(item)||!linkRight.has(item))return false;
 return true;
}
function boundaryEdges(faces){
 const occ=new Map();
 for(const triangle of faces)for(let e=0;e<3;e++){
  const start=triangle[e],end=triangle[(e+1)%3],key=start<end?`${start},${end}`:`${end},${start}`;
  if(!occ.has(key))occ.set(key,[]);
  occ.get(key).push([start,end]);
 }
 const locked=new Set();
 for(const [key,list] of occ){
  const manifold=list.length===2&&list[0][0]===list[1][1]&&list[0][1]===list[1][0];
  if(!manifold)locked.add(key);
 }
 return locked;
}
function faceNormal(positions,face){
 const a=positionOf(positions,face[0]),b=positionOf(positions,face[1]),c=positionOf(positions,face[2]);
 const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
 return [ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
}
function preservesSurvivingFaces(positions,faces,incident,keep,drop){
 for(const faceId of incident){
  const face=faces[faceId];
  if(face.includes(keep))continue;
  const next=face.map(v=>v===drop?keep:v);
  const before=faceNormal(positions,face),after=faceNormal(positions,next);
  const oldArea2=before[0]**2+before[1]**2+before[2]**2;
  const newArea2=after[0]**2+after[1]**2+after[2]**2;
  if(!(oldArea2>0)||!(newArea2>oldArea2*1e-12))return false;
  if(!(before[0]*after[0]+before[1]*after[1]+before[2]*after[2]>1e-6*Math.sqrt(oldArea2*newArea2)))return false;
 }
 return true;
}
/** Garland-Heckbert endpoint contraction. Boundary edges stay locked. New vertices are not created. */
export function simplifyToEndpoints(positions,indices,{targetTriangles}={}){
 if(!Number.isSafeInteger(targetTriangles)||targetTriangles<0)throw new Error('targetTriangles is required');
 if(positions.length%3!==0||indices.length%3!==0||positions.some(v=>!Number.isFinite(v)))throw new Error('Invalid geometry');
 const vertexCount=positions.length/3;
 let faces=[];
 for(let i=0;i<indices.length;i+=3){
  const a=Number(indices[i]),b=Number(indices[i+1]),c=Number(indices[i+2]);
  if(a===b||b===c||c===a)continue;
  if([a,b,c].some(v=>!Number.isInteger(v)||v<0||v>=vertexCount))throw new Error('Invalid index');
  faces.push([a,b,c]);
 }
 classifyTopology(faces.flat(),vertexCount);
 let errorObject=0;
 while(faces.length>targetTriangles){
  const locked=boundaryEdges(faces);
  const lockedVerts=new Set();
  for(const key of locked){const comma=key.indexOf(',');lockedVerts.add(Number(key.slice(0,comma)));lockedVerts.add(Number(key.slice(comma+1)));}
  const quadrics=Array.from({length:vertexCount},emptyQuadric);
  const vFaces=Array.from({length:vertexCount},()=>[]);
  for(let f=0;f<faces.length;f++){
   const [a,b,c]=faces[f];
   vFaces[a].push(f);vFaces[b].push(f);vFaces[c].push(f);
   const plane=planeOf(positionOf(positions,a),positionOf(positions,b),positionOf(positions,c));
   if(!plane)continue;
   addPlane(quadrics[a],plane);addPlane(quadrics[b],plane);addPlane(quadrics[c],plane);
  }
  let best=null;
  const tried=new Set();
  for(const triangle of faces){
   for(let e=0;e<3;e++){
    const left=triangle[e],right=triangle[(e+1)%3];
    const key=left<right?`${left},${right}`:`${right},${left}`;
    if(tried.has(key)||locked.has(key))continue;
    tried.add(key);
    const lockedLeft=lockedVerts.has(left),lockedRight=lockedVerts.has(right);
    if(lockedLeft&&lockedRight)continue;
    if(!linkCondition(vFaces,faces,left,right))continue;
    const combined=addQuadrics(quadrics[left],quadrics[right]);
    const costLeft=energy(combined,positionOf(positions,left));
    const costRight=energy(combined,positionOf(positions,right));
    let keep,drop,cost;
    if(lockedLeft){keep=left;drop=right;cost=costLeft;}
    else if(lockedRight){keep=right;drop=left;cost=costRight;}
    else{keep=costLeft<=costRight?left:right;drop=keep===left?right:left;cost=keep===left?costLeft:costRight;}
    if(!Number.isFinite(cost))continue;
    if(!preservesSurvivingFaces(positions,faces,vFaces[drop],keep,drop))continue;
    if(!best||cost<best.cost||(cost===best.cost&&drop<best.drop))best={cost,keep,drop};
   }
  }
  if(!best)break;
  errorObject=Math.max(errorObject,Math.sqrt(Math.max(0,best.cost)));
  const next=[];
  for(const [a,b,c] of faces){
   const tri=[a===best.drop?best.keep:a,b===best.drop?best.keep:b,c===best.drop?best.keep:c];
   if(tri[0]!==tri[1]&&tri[1]!==tri[2]&&tri[2]!==tri[0])next.push(tri);
  }
  if(next.length>=faces.length||(next.length===0&&faces.length>0))break;
  faces=next;
 }
 return {indices:faces.flat(),errorObject,triangles:faces.length};
}
