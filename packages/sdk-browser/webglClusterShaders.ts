export const CLUSTER_VERTEX = `#version 300 es
precision highp float;
in vec3 position;in vec3 normal;in vec4 tangent;in vec2 uv;in vec2 uv1;in vec4 color;
uniform mat4 modelViewMatrix,projectionMatrix;uniform mat3 normalMatrix;
out vec3 viewPosition;out vec3 viewNormal;out vec4 viewTangent;out vec2 texcoord0;out vec2 texcoord1;out vec4 vertexColor;
void main(){vec4 view=modelViewMatrix*vec4(position,1.0);viewPosition=view.xyz;
viewNormal=normalize(normalMatrix*normal);viewTangent=vec4(normalize(mat3(modelViewMatrix)*tangent.xyz),tangent.w);
texcoord0=uv;texcoord1=uv1;vertexColor=color;gl_Position=projectionMatrix*(modelViewMatrix*vec4(position,1.0));}`;

export const CLUSTER_FRAGMENT = `#version 300 es
precision highp float;const float PI=3.141592653589793;const int MAX_LIGHTS=64;
in vec3 viewPosition;in vec3 viewNormal;in vec4 viewTangent;in vec2 texcoord0;in vec2 texcoord1;in vec4 vertexColor;out vec4 outColor;
uniform vec4 baseFactor;uniform float metalFactor,roughFactor,alphaCutoff,aoStrength;uniform vec2 normalScale;
uniform vec3 emissiveFactor;uniform bool lit,toneMapped,srgbDestination,hasNormalMap,hasVertexColor,sharedMetalRough;uniform int mapMask;
uniform sampler2D baseMap,roughMap,metalMap,normalMap,aoMap,emissiveMap;
uniform mat3 baseUv,roughUv,metalUv,normalUv,aoUv,emissiveUv;
uniform int lightCount;uniform ivec4 mapChannels;uniform ivec2 extraChannels;layout(std140) uniform ClusterLights{vec4 lightData[256];};
vec2 sourceUv(int channel){return channel==1?texcoord1:texcoord0;}
vec2 mapUv(mat3 transform,vec2 source){return(transform*vec3(source,1.0)).xy;}
vec3 fresnel(float h,vec3 f0){return f0+(1.0-f0)*pow(max(0.0,1.0-h),5.0);}
float filteredRoughness(vec3 N,float rough){vec3 du=dFdx(N),dv=dFdy(N);float variance=.25*(dot(du,du)+dot(dv,dv));
float alpha=rough*rough,filtered=clamp(alpha*alpha+min(variance,.18),7.596914e-6,1.0);return sqrt(sqrt(filtered));}
vec3 brdf(vec3 N,vec3 V,vec3 L,vec3 base,float metal,float rough){float nl=max(dot(N,L),0.0),nv=max(dot(N,V),1e-4);if(nl==0.0)return vec3(0.0);
vec3 H=normalize(V+L);float nh=max(dot(N,H),0.0),vh=max(dot(V,H),0.0);float a=max(0.0525,rough);a*=a;float a2=a*a;
float d0=nh*nh*(a2-1.0)+1.0,D=a2/(PI*d0*d0);float gv=nl*sqrt(nv*nv*(1.0-a2)+a2),gl=nv*sqrt(nl*nl*(1.0-a2)+a2);
float Vis=0.5/(gv+gl+1e-7);vec3 F=fresnel(vh,mix(vec3(0.04),base,metal));return(base*(1.0-metal)/PI+D*Vis*F)*nl;}
float attenuation(float distance,float range){float a=1.0/max(distance*distance,0.01);if(range>0.0){float r=distance/range;a*=pow(clamp(1.0-r*r*r*r,0.0,1.0),2.0);}return a;}
vec3 aces(vec3 c){c/=0.6;c=mat3(0.59719,0.07600,0.02840,0.35458,0.90834,0.13383,0.04823,0.01566,0.83777)*c;
vec3 a=c*(c+0.0245786)-0.000090537,b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
return clamp(mat3(1.60475,-0.10208,-0.00327,-0.53108,1.10813,-0.07276,-0.07367,-0.00605,1.07602)*c,0.0,1.0);}
vec3 linearToSrgb(vec3 x){bvec3 low=lessThanEqual(x,vec3(0.0031308));return mix(1.055*pow(max(x,vec3(0.0)),vec3(1.0/2.4))-0.055,12.92*x,low);}
void main(){vec4 base=baseFactor;if((mapMask&1)!=0)base*=texture(baseMap,mapUv(baseUv,sourceUv(mapChannels.x)));if(hasVertexColor)base*=vertexColor;if(base.a<alphaCutoff)discard;
float roughSample=1.0,metalSample=1.0;if((mapMask&2)!=0){vec4 packed=texture(roughMap,mapUv(roughUv,sourceUv(mapChannels.y)));roughSample=packed.g;if(sharedMetalRough)metalSample=packed.b;}if((mapMask&4)!=0&&!sharedMetalRough)metalSample=texture(metalMap,mapUv(metalUv,sourceUv(mapChannels.z))).b;
float metal=clamp(metalFactor*metalSample,0.0,1.0),rough=clamp(roughFactor*roughSample,0.0525,1.0);
vec3 N=normalize(viewNormal);if(hasNormalMap){vec3 n=texture(normalMap,mapUv(normalUv,sourceUv(mapChannels.w))).xyz*2.0-1.0;n.xy*=normalScale;
vec3 T=normalize(viewTangent.xyz-N*dot(N,viewTangent.xyz)),B=normalize(cross(N,T)*viewTangent.w);N=normalize(mat3(T,B,N)*n);}if(!gl_FrontFacing)N=-N;
rough=filteredRoughness(N,rough);
vec3 rgb=vec3(0.0),V=normalize(-viewPosition);float ao=1.0;if((mapMask&16)!=0)ao+=aoStrength*(texture(aoMap,mapUv(aoUv,sourceUv(extraChannels.x))).r-1.0);if(lit){for(int i=0;i<MAX_LIGHTS;i++){if(i>=lightCount)break;
vec4 positionRange=lightData[i*4],directionKind=lightData[i*4+1],colorIntensity=lightData[i*4+2],cone=lightData[i*4+3];
int kind=int(directionKind.w);if(kind==3){rgb+=base.rgb*(1.0-metal)/PI*colorIntensity.rgb*colorIntensity.w*ao;continue;}
vec3 L;float falloff=1.0;if(kind==0)L=normalize(-directionKind.xyz);else{vec3 delta=positionRange.xyz-viewPosition;float d=length(delta);L=delta/max(d,1e-6);falloff=attenuation(d,positionRange.w);
if(kind==2){float c=dot(L,normalize(-directionKind.xyz));falloff*=smoothstep(cone.y,cone.x,c);}}
rgb+=brdf(N,V,L,base.rgb,metal,rough)*colorIntensity.rgb*colorIntensity.w*falloff;}}
else rgb=base.rgb;
if((mapMask&32)!=0)rgb+=emissiveFactor*texture(emissiveMap,mapUv(emissiveUv,sourceUv(extraChannels.y))).rgb;else rgb+=emissiveFactor;if(toneMapped)rgb=aces(rgb);if(srgbDestination)rgb=linearToSrgb(rgb);outColor=vec4(rgb,base.a);}`;
