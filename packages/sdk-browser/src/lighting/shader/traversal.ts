export const lightingTraversalShader = `bool intersectScene(vec3 origin,vec3 direction,float limit,out int object,out vec3 p,out vec3 n){
 float closest=limit;
 object=-2;
 if(useBvh){
  vec3 inverseDirection=inverseRayDirection(direction);
  int node=0;
  for(int visit=0;visit<BVH_NODE_COUNT;visit++){
   if(node>=BVH_NODE_COUNT)break;
   vec4 low=texelFetch(bvhData,ivec2(0,node),0),high=texelFetch(bvhData,ivec2(1,node),0);
   if(!intersectsBounds(low.xyz,high.xyz,origin,direction,inverseDirection,closest)){node=int(low.w);continue;}
   int i=int(high.w);
   if(i>=0){
    float distance;vec3 hit;vec3 normal;
    // Use the ORIGINAL limit so an equal-distance lower index remains eligible.
    if(intersectRectangle(i,origin,direction,limit,distance,hit,normal)&&
     (distance<closest||(distance==closest&&(object<0||i<object)))){
     closest=distance;object=i;p=hit;n=normal;
    }
   }
   node++;
  }
 }else{
  for(int i=0;i<SURFACE_COUNT;i++){
   float distance;vec3 hit;vec3 normal;
   if(intersectRectangle(i,origin,direction,closest,distance,hit,normal)){
    closest=distance;object=i;p=hit;n=normal;
   }
  }
 }
 // Strict inequality retains the rectangle when the sphere has an equal hit.
 float distance=intersectSphere(origin,direction,closest);
 if(distance<closest){object=-1;p=origin+direction*distance;n=normalize(p-sphere.xyz);}
 return object!=-2;
}

bool shadowBlocked(vec3 origin,vec3 direction,float limit){
 if(intersectSphere(origin,direction,limit)<limit)return true;
 if(useBvh){
  vec3 inverseDirection=inverseRayDirection(direction);
  int node=0;
  for(int visit=0;visit<BVH_NODE_COUNT;visit++){
   if(node>=BVH_NODE_COUNT)break;
   vec4 low=texelFetch(bvhData,ivec2(0,node),0),high=texelFetch(bvhData,ivec2(1,node),0);
   if(!intersectsBounds(low.xyz,high.xyz,origin,direction,inverseDirection,limit)){node=int(low.w);continue;}
   int i=int(high.w);
   if(i>=0){
    float distance;vec3 hit;vec3 normal;
    if(intersectRectangle(i,origin,direction,limit,distance,hit,normal))return true;
   }
   node++;
  }
 }else{
  for(int i=0;i<SURFACE_COUNT;i++){
   float distance;vec3 hit;vec3 normal;
   if(intersectRectangle(i,origin,direction,limit,distance,hit,normal))return true;
  }
 }
 return false;
}

`;
