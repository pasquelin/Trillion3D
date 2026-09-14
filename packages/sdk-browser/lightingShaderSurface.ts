export const lightingSurfaceShader = `precision highp float;
uniform highp sampler2D indirectCache;
uniform highp sampler2D surfaceData;
uniform highp sampler2D bvhData;
uniform bool useBvh;
uniform vec2 cacheSize;
uniform vec4 sphere;
uniform float sphereRoughness;
uniform int primarySurface;
uniform int reflectionSamples;
uniform int emitterCount;
uniform int emitterIndices[MAX_EMITTERS];
uniform int directLightSamples;
uniform int directLightGrid;
uniform float experimentExposure;
varying vec3 worldPosition;
const float PI=3.141592653589793;
const float RAY_EPSILON=0.0001;
const vec3 SPECULAR_F0=vec3(0.92);

// Float texture avoids a scene-sized uniform array exceeding WebGL2 limits.
vec4 surfaceRecord(int i,int field){return texelFetch(surfaceData,ivec2(field,i),0);}
float mirrorFlag(int i){return surfaceRecord(i,0).w;}
vec3 surfaceNormal(int i){return normalize(cross(surfaceRecord(i,1).xyz,surfaceRecord(i,2).xyz));}
vec2 surfaceUv(int i,vec3 p){
 vec3 q=p-surfaceRecord(i,0).xyz,u=surfaceRecord(i,1).xyz,v=surfaceRecord(i,2).xyz;
 return vec2(dot(q,u)/dot(u,u),dot(q,v)/dot(v,v));
}
vec3 cacheTexel(vec2 p){return texture2D(indirectCache,(p+0.5)/cacheSize).rgb;}
vec3 rayOrigin(vec3 p,vec3 normal,vec3 direction){
 return p+normal*(dot(normal,direction)>=0.0?2.0*RAY_EPSILON:-2.0*RAY_EPSILON);
}
vec3 cachedIndirectIrradiance(int i,vec3 p){
 // xy: first texel, zw: grid dimensions. Filtering stays within one surface.
 vec4 tile=surfaceRecord(i,5);
 vec2 grid=clamp(surfaceUv(i,p)*tile.zw-0.5,vec2(0.0),tile.zw-1.0);
 vec2 lo=floor(grid),hi=min(lo+1.0,tile.zw-1.0),f=fract(grid);
 vec3 lower=mix(cacheTexel(tile.xy+lo),cacheTexel(tile.xy+vec2(hi.x,lo.y)),f.x);
 vec3 upper=mix(cacheTexel(tile.xy+vec2(lo.x,hi.y)),cacheTexel(tile.xy+hi),f.x);
 return mix(lower,upper,f.y);
}

`;
