import { TRANSMISSION_GLSL } from './transmissionGlsl.ts';
import { OUTPUT_TRANSFER_GLSL } from '../core/outputGlsl.ts';
import { RECT_LIGHT_GLSL, WEBGL_RECT_KIND } from './rectGlsl.ts';
import { PROBE_IRRADIANCE_GLSL } from './probe.ts';
import { INVERSE_PI, PI } from '../../lighting/shaderConstants.ts';

// An instanced mesh places each copy by its own matrix before the mesh's: the position first,
// then the normal, scaled back by the matrix's axes before it is turned — the reference's order.
// A mesh drawn once keeps its own expression, whose constant w the compiler folds as the
// reference's does: sharing one with the instanced branch moves its last bit.
export const CLUSTER_VERTEX = `#version 300 es
precision highp float;
in vec3 position;in vec3 normal;in vec2 uv;in vec2 uv1;in vec4 color;in mat4 instanceMatrix;
uniform mat4 modelViewMatrix,projectionMatrix;uniform mat3 normalMatrix;uniform bool instanced;
out vec3 viewPosition;out vec3 viewNormal;out vec2 texcoord0;out vec2 texcoord1;out vec4 vertexColor;
void main(){vec4 view;vec3 objectNormal=normal;
if(instanced){view=modelViewMatrix*(instanceMatrix*vec4(position,1.0));mat3 im=mat3(instanceMatrix);
objectNormal/=vec3(dot(im[0],im[0]),dot(im[1],im[1]),dot(im[2],im[2]));objectNormal=im*objectNormal;}
else view=modelViewMatrix*vec4(position,1.0);viewPosition=view.xyz;
viewNormal=normalize(normalMatrix*objectNormal);
texcoord0=uv;texcoord1=uv1;vertexColor=color;gl_Position=projectionMatrix*view;}`;

// The view vector reads the camera as one homogeneous point (`EngineCamera.viewPoint`), in view
// space: the origin under a perspective projection, +z under an orthographic one — its weight p
// is the projection's own clip-w row, `-projectionMatrix[2][3]`, 1 or 0.
// `cotangentFrame`: the tangent frame a page does not store, from the screen derivatives of
// position and texture coordinate — the WGSL routine of `../../cluster/decodeWgsl.ts`, operation for
// operation, so the three lighting passes bend a normal map in one frame.
// A surface declared flat (`flatShaded`) takes the face's normal from the same derivatives of
// position, as the reference does, already facing the eye: it is never turned for a back face.
export const CLUSTER_FRAGMENT = `#version 300 es
precision highp float;const float PI=${PI},INVERSE_PI=${INVERSE_PI};const int MAX_LIGHTS=64;
in vec3 viewPosition;in vec3 viewNormal;in vec2 texcoord0;in vec2 texcoord1;in vec4 vertexColor;out vec4 outColor;
uniform vec4 baseFactor;uniform float metalFactor,roughFactor,alphaCutoff,aoStrength;uniform vec2 normalScale;
uniform vec3 emissiveFactor;uniform bool lit,flatShaded,toneMapped,srgbDestination,hasNormalMap,hasVertexColor,sharedMetalRough;uniform int mapMask;
uniform sampler2D baseMap,roughMap,metalMap,normalMap,aoMap,emissiveMap;
uniform mat3 baseUv,roughUv,metalUv,normalUv,aoUv,emissiveUv;
uniform mat4 projectionMatrix;uniform int lightCount;uniform ivec4 mapChannels;uniform ivec2 extraChannels;layout(std140) uniform ClusterLights{vec4 lightData[256];};
vec2 sourceUv(int channel){return channel==1?texcoord1:texcoord0;}
vec2 mapUv(mat3 transform,vec2 source){return(transform*vec3(source,1.0)).xy;}
struct CotangentFrame{vec3 T;vec3 B;};
CotangentFrame cotangentFrame(vec3 N,vec3 e1,vec3 e2,vec2 duv1,vec2 duv2){vec3 p=cross(e2,N),q=cross(N,e1);
vec3 T=p*duv1.x+q*duv2.x,B=p*duv1.y+q*duv2.y;float scale=inversesqrt(max(max(dot(T,T),dot(B,B)),1e-20));
return CotangentFrame(T*scale,B*scale);}
vec3 fresnel(float h,vec3 f0){return f0+(1.0-f0)*pow(max(0.0,1.0-h),5.0);}
float filteredRoughness(vec3 N,float rough){vec3 du=dFdx(N),dv=dFdy(N);float variance=.25*(dot(du,du)+dot(dv,dv));
float alpha=rough*rough,filtered=clamp(alpha*alpha+min(variance,.18),7.596914e-6,1.0);return sqrt(sqrt(filtered));}
vec3 brdf(vec3 N,vec3 V,vec3 L,vec3 base,float metal,float rough){float nl=max(dot(N,L),0.0),nv=max(dot(N,V),1e-4);if(nl==0.0)return vec3(0.0);
vec3 H=normalize(V+L);float nh=max(dot(N,H),0.0),vh=max(dot(V,H),0.0);float a=max(0.0525,rough);a*=a;float a2=a*a;
float d0=nh*nh*(a2-1.0)+1.0,D=a2/(PI*d0*d0);float gv=nl*sqrt(nv*nv*(1.0-a2)+a2),gl=nv*sqrt(nl*nl*(1.0-a2)+a2);
float Vis=0.5/(gv+gl+1e-7);vec3 F=fresnel(vh,mix(vec3(0.04),base,metal));return(base*(1.0-metal)/PI+D*Vis*F)*nl;}
float rangeWindow(float distance,float range){if(range<=0.0)return 1.0;float r=distance/range;return pow(clamp(1.0-r*r*r*r,0.0,1.0),2.0);}
float attenuation(float distance,float range){return 1.0/max(distance*distance,0.01)*rangeWindow(distance,range);}
float spotFactor(float cosine,float inner,float outer){return inner<=outer?(cosine>=outer?1.0:0.0):smoothstep(outer,inner,cosine);}
${OUTPUT_TRANSFER_GLSL}
${RECT_LIGHT_GLSL}
${PROBE_IRRADIANCE_GLSL}
// The declared lights on one surface: the engine's only lighting formula, ambient and probe included.
// The ambient irradiance is summed before the probe's and weighted once, occlusion last, in the
// reference's order of operations: an unlit view then writes its albedo to the last bit.
vec3 shade(vec3 N,vec3 V,vec3 base,float metal,float rough,float ao){vec3 rgb=vec3(0.0),irradiance=vec3(0.0);for(int i=0;i<MAX_LIGHTS;i++){if(i>=lightCount)break;
vec4 positionRange=lightData[i*4],directionKind=lightData[i*4+1],colorIntensity=lightData[i*4+2],cone=lightData[i*4+3];
int kind=int(directionKind.w);if(kind==3){irradiance+=colorIntensity.rgb*colorIntensity.w;continue;}
if(kind==${WEBGL_RECT_KIND}){rgb+=rectLight(positionRange,directionKind.xyz,cone,colorIntensity,N,V,viewPosition,base,metal,rough);continue;}
vec3 L;float falloff=1.0;if(kind==0)L=normalize(-directionKind.xyz);else{vec3 delta=positionRange.xyz-viewPosition;float d=length(delta);L=delta/max(d,1e-6);falloff=attenuation(d,positionRange.w);
if(kind==2){float c=dot(L,normalize(-directionKind.xyz));falloff*=spotFactor(c,cone.x,cone.y);}}
rgb+=brdf(N,V,L,base,metal,rough)*colorIntensity.rgb*colorIntensity.w*falloff;}
irradiance+=probeIrradiance(N);return rgb+irradiance*(INVERSE_PI*(base*(1.0-metal)))*ao;}
${TRANSMISSION_GLSL}
void main(){vec4 base=baseFactor;if((mapMask&1)!=0)base*=texture(baseMap,mapUv(baseUv,sourceUv(mapChannels.x)));if(hasVertexColor)base*=vertexColor;if(base.a<alphaCutoff)discard;
float roughSample=1.0,metalSample=1.0;if((mapMask&2)!=0){vec4 packed=texture(roughMap,mapUv(roughUv,sourceUv(mapChannels.y)));roughSample=packed.g;if(sharedMetalRough)metalSample=packed.b;}if((mapMask&4)!=0&&!sharedMetalRough)metalSample=texture(metalMap,mapUv(metalUv,sourceUv(mapChannels.z))).b;
float metal=clamp(metalFactor*metalSample,0.0,1.0),rough=clamp(roughFactor*roughSample,0.0525,1.0);
vec3 N=flatShaded?normalize(cross(dFdx(viewPosition),dFdy(viewPosition))):normalize(viewNormal);if(hasNormalMap){vec2 st=sourceUv(mapChannels.w);vec3 n=texture(normalMap,mapUv(normalUv,st)).xyz*2.0-1.0;n.xy*=normalScale;
CotangentFrame frame=cotangentFrame(N,dFdx(viewPosition),dFdy(viewPosition),dFdx(st),dFdy(st));N=normalize(frame.T*n.x+frame.B*n.y+N*n.z);}if(!gl_FrontFacing&&!flatShaded)N=-N;
rough=filteredRoughness(N,rough);
float p=-projectionMatrix[2][3];vec3 V=normalize(vec3(0.0,0.0,1.0-p)-viewPosition*p);float ao=1.0;if((mapMask&16)!=0)ao=(texture(aoMap,mapUv(aoUv,sourceUv(extraChannels.x))).r-1.0)*aoStrength+1.0;
vec3 rgb=lit?shade(N,V,base.rgb,metal,rough,ao):base.rgb*ao;
if((mapMask&32)!=0)rgb+=emissiveFactor*texture(emissiveMap,mapUv(emissiveUv,sourceUv(extraChannels.y))).rgb;else rgb+=emissiveFactor;
float alpha=base.a;if(transmissive){vec4 through=transmissionColor(rgb,base.rgb,alpha,N,V,viewPosition,rough,ao);rgb=through.rgb;alpha=through.a;}
if(toneMapped)rgb=toneMap(rgb);if(srgbDestination)rgb=linearToSrgb(rgb);outColor=vec4(rgb,alpha);}`;
