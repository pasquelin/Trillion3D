import { PALETTE_FLOATS } from '../../../sdk-core/src/world/animation/skeleton.ts';
import { LIGHT_ROW_TEXELS } from '../webgl/cluster/lightTexture.ts';
import { KIND_MORPH, KIND_SKIN, KIND_WAVE, KIND_SOFT, RECORD_HEAD, WAVE_FLOATS } from './layout.ts';

/**
 * THE GPU DEFORMATION STAGE (#357) in the WebGL2 program's vertex stage: `DEFORM_WGSL`
 * (`deformWgsl.ts`) operation for operation, on the same records (`layout.ts`) — morph targets,
 * then the joints' linear blend, then the waves on the world point. The block is a float texture
 * of `LIGHT_ROW_TEXELS` texels a row (`webglDeformation.ts`), each record on a texel boundary, its
 * head's counts written as float values; `deformDraw` names the draw's record (its first float
 * plus one, zero for none), whether its page is skinned and how many targets its page carries,
 * whose displacements `morphDeltas` holds, two texels a target per vertex. The page's own joints
 * and weights are its `skinIndex` and `skinWeight` attributes. With no record the rest vertex is
 * left as it is: an undeformed draw reads exactly what it read before.
 */
export const DEFORM_GLSL = `uniform highp sampler2D deformBlock,morphDeltas;uniform ivec3 deformDraw;
vec4 deformTexel(highp sampler2D block,int t){return texelFetch(block,ivec2(t%${LIGHT_ROW_TEXELS},t/${LIGHT_ROW_TEXELS}),0);}
float deformFloat(int i){vec4 v=deformTexel(deformBlock,i>>2);int c=i&3;return c==0?v.x:c==1?v.y:c==2?v.z:v.w;}
vec3 deformJoint(int at,float j,int count,vec4 v){int b=(at+min(int(j),count-1)*${PALETTE_FLOATS})>>2;
return vec3(dot(deformTexel(deformBlock,b),v),dot(deformTexel(deformBlock,b+1),v),dot(deformTexel(deformBlock,b+2),v));}
vec2 deformInfluence(int k){return deformTexel(morphDeltas,gl_VertexID*(deformDraw.y+deformDraw.z*2)+k).xy;}
vec3 deformSkin(int at,int count,vec4 v){vec3 result=vec3(0.0);
for(int k=0;k<deformDraw.y;k++){vec2 pair=deformInfluence(k);if(pair.y!=0.0)result+=pair.y*deformJoint(at,pair.x,count,v);}return result;}
mat4 deformMatrix(int at){mat4 m;for(int c=0;c<4;c++)m[c]=vec4(deformFloat(at+c*4),deformFloat(at+c*4+1),deformFloat(at+c*4+2),deformFloat(at+c*4+3));return m;}
vec3 deformMorph(int t,bool normal){int k=gl_VertexID*(deformDraw.y+deformDraw.z*2)+deformDraw.y+t*2+(normal?1:0);return deformTexel(morphDeltas,k).xyz;}
vec3 deformWaves(int at,int count,vec3 p,bool normal){vec3 d=vec3(0.0),n=vec3(0.0,1.0,0.0);
for(int i=0;i<count;i++){int b=at+i*${WAVE_FLOATS};float dx=deformFloat(b),dz=deformFloat(b+1),k=deformFloat(b+2),amplitude=deformFloat(b+3),lateral=deformFloat(b+4);
float f=k*(dx*p.x+dz*p.z)-deformFloat(b+5),c=cos(f),s=sin(f);d+=vec3(lateral*dx*c,amplitude*s,lateral*dz*c);n-=vec3(dx*k*amplitude*c,k*lateral*s,dz*k*amplitude*c);}
return normal?normalize(n):d;}
vec3 deformSoft(int at,int count,bool normal){vec3 delta=vec3(0.0);
for(int k=0;k<deformDraw.y;k++){vec2 pair=deformInfluence(k);int v=min(int(pair.x),count-1)*3;
int current=at+v+(normal?count*9:0),rest=at+v+count*6;
vec3 value=vec3(deformFloat(current),deformFloat(current+1),deformFloat(current+2));
vec3 origin=vec3(deformFloat(rest),deformFloat(rest+1),deformFloat(rest+2));
delta+=pair.y*(normal?value:value-origin);}return delta;}
void deform(inout vec3 p,inout vec3 n){int r=deformDraw.x-1;if(r<0)return;vec4 head=deformTexel(deformBlock,r>>2);
int kinds=int(head.x),joints=int(head.z),targets=int(head.w),waves=int(deformFloat(r+4));
int palette=r+${RECORD_HEAD},weights=palette+2*joints*${PALETTE_FLOATS},world=weights+2*targets;vec3 rest=p;
int soft=int(deformFloat(r+5));
if((kinds&${KIND_SOFT})!=0&&deformDraw.y!=0){int simulation=world+(waves>0?32:0)+waves*${WAVE_FLOATS};p+=deformSoft(simulation,soft,false);n=deformSoft(simulation,soft,true);}
if((kinds&${KIND_MORPH})!=0)for(int t=0;t<min(targets,deformDraw.z);t++){float w=deformFloat(weights+t);if(w!=0.0){p+=w*deformMorph(t,false);n+=w*deformMorph(t,true);}}
if((kinds&${KIND_SKIN})!=0&&deformDraw.y!=0){p=deformSkin(palette,joints,vec4(p,1.0));n=deformSkin(palette,joints,vec4(n,0.0));}
if((kinds&${KIND_WAVE})!=0){mat4 m=deformMatrix(world);vec3 at=(m*vec4(p,1.0)).xyz;
p=(deformMatrix(world+16)*vec4(at+deformWaves(world+32,waves,at,false),1.0)).xyz;
n=transpose(mat3(m))*deformWaves(world+32,waves,(m*vec4(rest,1.0)).xyz,true);}}`;
