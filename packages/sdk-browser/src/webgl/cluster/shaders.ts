import { TRANSMISSION_GLSL } from './transmissionGlsl.ts';
import { OUTPUT_TRANSFER_GLSL } from '../core/outputGlsl.ts';
import { RECT_LIGHT_GLSL, WEBGL_RECT_KIND } from './rectGlsl.ts';
import { PROBE_IRRADIANCE_GLSL } from './probe.ts';
import { INVERSE_PI, PI } from '../../lighting/shaderConstants.ts';
import { FOG_GLSL } from '../../lighting/fogShader.ts';

// An instanced mesh places each copy by its own matrix before the mesh's: the position first,
// then the normal, scaled back by the matrix's axes before it is turned — the reference's order.
// A mesh drawn once keeps its own expression, whose constant w the compiler folds as the
// reference's does: sharing one with the instanced branch moves its last bit. The position is
// carried to the fragment negated, toward the eye, as the reference carries it: the compiler
// rounds a negated product-sum otherwise, and the flat normals its derivatives give move by an ulp.
export const CLUSTER_VERTEX = `#version 300 es
precision highp float;
in vec3 position;in vec3 normal;in vec2 uv;in vec2 uv1;in vec4 color;in mat4 instanceMatrix;
uniform mat4 modelViewMatrix,projectionMatrix;uniform mat3 normalMatrix;uniform bool instanced;
out vec3 toEye;out vec3 viewNormal;out vec2 texcoord0;out vec2 texcoord1;out vec4 vertexColor;
void main(){vec4 view;vec3 objectNormal=normal;
if(instanced){view=modelViewMatrix*(instanceMatrix*vec4(position,1.0));mat3 im=mat3(instanceMatrix);
objectNormal/=vec3(dot(im[0],im[0]),dot(im[1],im[1]),dot(im[2],im[2]));objectNormal=im*objectNormal;}
else view=modelViewMatrix*vec4(position,1.0);toEye=-view.xyz;
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
in vec3 toEye;in vec3 viewNormal;vec3 viewPosition;in vec2 texcoord0;in vec2 texcoord1;in vec4 vertexColor;out vec4 outColor;
uniform vec4 baseFactor;uniform float metalFactor,roughFactor,alphaCutoff,aoStrength;uniform vec2 normalScale;
uniform vec3 emissiveFactor;uniform vec2 depthRamp;uniform bool depthShaded,lit,flatShaded,toneMapped,srgbDestination,hasNormalMap,hasVertexColor,sharedMetalRough;uniform int mapMask,faceSides;
uniform sampler2D baseMap,roughMap,metalMap,normalMap,aoMap,emissiveMap;
uniform mat3 baseUv,roughUv,metalUv,normalUv,aoUv,emissiveUv;
uniform mat4 projectionMatrix;uniform int lightCount;uniform ivec4 mapChannels;uniform ivec2 extraChannels;layout(std140) uniform ClusterLights{vec4 lightData[256];};
vec2 sourceUv(int channel){return channel==1?texcoord1:texcoord0;}
vec2 mapUv(mat3 transform,vec2 source){return(transform*vec3(source,1.0)).xy;}
struct CotangentFrame{vec3 T;vec3 B;};
CotangentFrame cotangentFrame(vec3 N,vec3 e1,vec3 e2,vec2 duv1,vec2 duv2){vec3 p=cross(e2,N),q=cross(N,e1);
vec3 T=p*duv1.x+q*duv2.x,B=p*duv1.y+q*duv2.y;float scale=inversesqrt(max(max(dot(T,T),dot(B,B)),1e-20));
return CotangentFrame(T*scale,B*scale);}
float geometryRoughness(vec3 n){vec3 dxy=max(abs(dFdx(n)),abs(dFdy(n)));return max(max(dxy.x,dxy.y),dxy.z);}
vec3 fresnel(vec3 f0,float vh){float f=exp2((-5.55473*vh-6.98316)*vh);return f0*(1.0-f)+f;}
vec3 specularLobe(vec3 L,vec3 V,vec3 N,vec3 f0,float rough){float alpha=rough*rough;vec3 H=normalize(L+V);
float nl=clamp(dot(N,L),0.0,1.0),nv=clamp(dot(N,V),0.0,1.0),nh=clamp(dot(N,H),0.0,1.0),vh=clamp(dot(V,H),0.0,1.0);vec3 F=fresnel(f0,vh);
float a2=alpha*alpha,gv=nl*sqrt(a2+(1.0-a2)*(nv*nv)),gl=nv*sqrt(a2+(1.0-a2)*(nl*nl)),Vis=0.5/max(gv+gl,1e-6);
float d=(nh*nh)*(a2-1.0)+1.0,D=INVERSE_PI*a2/(d*d);return F*(Vis*D);}
float rangeWindow(float distance,float range){if(range<=0.0)return 1.0;float r=distance/range;return pow(clamp(1.0-r*r*r*r,0.0,1.0),2.0);}
float attenuation(float distance,float range,float decay){float falloff=1.0/max(pow(distance,decay),0.01);
if(range>0.0){float r=distance/range,r2=r*r,s=clamp(1.0-r2*r2,0.0,1.0);falloff*=s*s;}return falloff;}
float spotFactor(float cosine,float inner,float outer){return inner<=outer?(cosine>=outer?1.0:0.0):smoothstep(outer,inner,cosine);}
${OUTPUT_TRANSFER_GLSL}
${RECT_LIGHT_GLSL}
${PROBE_IRRADIANCE_GLSL}
${FOG_GLSL}
// The declared lights on one surface: the engine's only lighting formula, ambient and probe included.
// In the reference's order of operations, so that a lit view writes its image to the last bit:
// each direct light's irradiance (its colour already scaled by its intensity, lights.ts) weighs
// a diffuse and a specular sum kept apart; the ambient irradiance, summed once, and the probe's
// are weighted once, occlusion last; diffuse, then specular.
vec3 shade(vec3 N,vec3 V,vec3 base,float metal,float rough,float ao){vec3 diffuse=base*(1.0-metal),f0=mix(vec3(0.04),base,metal);
vec3 direct=vec3(0.0),specular=vec3(0.0),irradiance=vec3(0.0);for(int i=0;i<MAX_LIGHTS;i++){if(i>=lightCount)break;
vec4 positionRange=lightData[i*4],directionKind=lightData[i*4+1],colorIntensity=lightData[i*4+2],cone=lightData[i*4+3];
int kind=int(directionKind.w);if(kind==3){irradiance+=colorIntensity.rgb;continue;}
if(kind==${WEBGL_RECT_KIND}){direct+=rectLight(positionRange,directionKind.xyz,cone,colorIntensity,N,V,viewPosition,base,metal,rough);continue;}
vec3 L,color=colorIntensity.rgb;if(kind==0)L=directionKind.xyz;else{vec3 toLight=positionRange.xyz-viewPosition;L=normalize(toLight);
if(kind==2){float s=spotFactor(dot(L,directionKind.xyz),cone.x,cone.y);if(s<=0.0)continue;color=color*s;}
color*=attenuation(length(toLight),positionRange.w,cone.z);}
vec3 E=clamp(dot(N,L),0.0,1.0)*color;specular+=E*specularLobe(L,V,N,f0,rough);direct+=E*(INVERSE_PI*diffuse);}
irradiance+=probeIrradiance(N);return(direct+irradiance*(INVERSE_PI*diffuse)*ao)+specular;}
${TRANSMISSION_GLSL}
void main(){viewPosition=-toEye;vec4 base=baseFactor;if((mapMask&1)!=0)base*=texture(baseMap,mapUv(baseUv,sourceUv(mapChannels.x)));if(hasVertexColor)base*=vertexColor;if(base.a<alphaCutoff)discard;
float roughSample=1.0,metalSample=1.0;if((mapMask&2)!=0){vec4 packed=texture(roughMap,mapUv(roughUv,sourceUv(mapChannels.y)));roughSample=packed.g;if(sharedMetalRough)metalSample=packed.b;}if((mapMask&4)!=0&&!sharedMetalRough)metalSample=texture(metalMap,mapUv(metalUv,sourceUv(mapChannels.z))).b;
float metal=clamp(metalFactor*metalSample,0.0,1.0);
float facing=gl_FrontFacing?1.0:-1.0;vec3 N;if(flatShaded)N=normalize(cross(dFdx(viewPosition),dFdy(viewPosition)));else{N=normalize(viewNormal);if(faceSides!=0)N*=facing;}
float rough=min(max(roughFactor*roughSample,0.0525)+geometryRoughness(N),1.0);
if(hasNormalMap){vec2 st=sourceUv(mapChannels.w);vec3 n=texture(normalMap,mapUv(normalUv,st)).xyz*2.0-1.0;n.xy*=normalScale;
CotangentFrame frame=cotangentFrame(N,dFdx(viewPosition),dFdy(viewPosition),dFdx(st),dFdy(st));vec3 T=frame.T,B=frame.B;if(faceSides==2&&!flatShaded){T*=facing;B*=facing;}N=normalize(mat3(T,B,N)*n);}
float p=-projectionMatrix[2][3];vec3 V=normalize(vec3(0.0,0.0,1.0-p)-viewPosition*p);float ao=1.0;if((mapMask&16)!=0)ao=(texture(aoMap,mapUv(aoUv,sourceUv(extraChannels.x))).r-1.0)*aoStrength+1.0;
vec3 rgb=lit?shade(N,V,base.rgb,metal,rough,ao):base.rgb*ao;
if((mapMask&32)!=0)rgb+=emissiveFactor*texture(emissiveMap,mapUv(emissiveUv,sourceUv(extraChannels.y))).rgb;else rgb+=emissiveFactor;
if(lit)rgb=fogged(rgb);
if(depthShaded)rgb=vec3(clamp(depthRamp.x*toEye.z+depthRamp.y,0.0,1.0));
float alpha=base.a;if(transmissive){vec4 through=transmissionColor(rgb,base.rgb,alpha,N,V,viewPosition,rough,ao);rgb=through.rgb;alpha=through.a;}
if(toneMapped)rgb=toneMap(rgb);if(srgbDestination)rgb=linearToSrgb(rgb);outColor=vec4(rgb,alpha);}`;
