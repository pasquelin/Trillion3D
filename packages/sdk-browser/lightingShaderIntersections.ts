export const lightingIntersectionsShader = `// Shared intersection arithmetic: nearest-hit for reflections, any-hit for
// opaque shadow segments. Neither path traces a triangle BVH.
bool intersectRectangle(int i,vec3 origin,vec3 direction,float limit,out float distance,out vec3 hit,out vec3 normal){
 vec3 corner=surfaceRecord(i,0).xyz,u=surfaceRecord(i,1).xyz,v=surfaceRecord(i,2).xyz;
 normal=normalize(cross(u,v));
 float denominator=dot(direction,normal);
 if(abs(denominator)<1.0e-7)return false;
 distance=dot(corner-origin,normal)/denominator;
 if(distance<=RAY_EPSILON||distance>=limit)return false;
 hit=origin+direction*distance;
 vec3 q=hit-corner;
 vec2 uv=vec2(dot(q,u)/dot(u,u),dot(q,v)/dot(v,v));
 return !any(lessThan(uv,vec2(0.0)))&&!any(greaterThan(uv,vec2(1.0)));
}

float intersectSphere(vec3 origin,vec3 direction,float limit){
 vec3 oc=origin-sphere.xyz;
 float b=dot(oc,direction),c=dot(oc,oc)-sphere.w*sphere.w;
 float discriminant=b*b-c;
 if(discriminant>=0.0){
  float distance=-b-sqrt(discriminant);
  if(distance<=RAY_EPSILON)distance=-b+sqrt(discriminant);
  if(distance>RAY_EPSILON&&distance<limit)return distance;
 }
 return limit;
}

vec3 inverseRayDirection(vec3 direction){
 vec3 inverseDirection=vec3(0.0);
 for(int axis=0;axis<3;axis++)if(abs(direction[axis])>=1.0e-19)inverseDirection[axis]=1.0/direction[axis];
 return inverseDirection;
}

bool intersectsBounds(vec3 low,vec3 high,vec3 origin,vec3 direction,vec3 inverseDirection,float limit){
 float nearDistance=RAY_EPSILON,farDistance=limit;
 for(int axis=0;axis<3;axis++){
  if(direction[axis]==0.0){
   if(origin[axis]<low[axis]||origin[axis]>high[axis])return false;
  }else if(abs(direction[axis])>=1.0e-19){
   float a=(low[axis]-origin[axis])*inverseDirection[axis],b=(high[axis]-origin[axis])*inverseDirection[axis];
   nearDistance=max(nearDistance,min(a,b));farDistance=min(farDistance,max(a,b));
   if(nearDistance>farDistance)return false;
  }
  // An extremely small nonzero direction leaves this axis unconstrained.
  // This only admits extra candidates, avoiding overflow and 0*infinity NaNs.
 }
 return true;
}

`;
