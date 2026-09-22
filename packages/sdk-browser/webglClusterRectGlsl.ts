import { LTC_SIZE } from '../sdk-core/ltcTable.ts';
import { INVERSE_TWO_PI } from './shaderConstants.ts';

/** The WebGL2 program's rank of a rectangle in `lightData`, after its ambient (3). */
export const WEBGL_RECT_KIND = 4;
/** Texture unit of the fitted lobe, after the six material maps and the two backdrop units. */
export const LTC_UNIT = 8;

/**
 * A RECTANGULAR LIGHT in the WebGL2 cluster program: the same evaluation as the WebGPU path's
 * (`directRectLightWgsl.ts`), operation for operation, on the same fitted table (`ltcTable.ts`),
 * read here as a `2·LTC_SIZE × LTC_SIZE` float texture — texel `(2x + k, y)` is the table's cell
 * `(x, y)`, vec4 `k`. The diffuse is the exact clipped form factor of the rectangle; the
 * specular, the rectangle moved by the fitted M⁻¹ and integrated the same way. No cast shadow,
 * as on the WebGPU path: the contract refuses one for a rectangle.
 *
 * A light's four vec4 hold its centre and range, its emitting normal and rank, its colour and
 * intensity, then its half-width axis and half height — all in view space.
 */
export const RECT_LIGHT_GLSL = `
const int LTC_SIZE=${LTC_SIZE};uniform highp sampler2D ltcTable;
vec3 rectEdge(vec3 a,vec3 b){vec3 c=cross(a,b);float s=length(c);float theta=acos(clamp(dot(a,b),-1.0,1.0));return c*(s>1e-7?theta/s:1.0);}
vec4 polygonFormFactor(vec3 a,vec3 b,vec3 c,vec3 d,vec3 up){vec3 na=normalize(a),nb=normalize(b),nc=normalize(c),nd=normalize(d);
vec3 F=(rectEdge(na,nb)+rectEdge(nb,nc)+rectEdge(nc,nd)+rectEdge(nd,na))*${INVERSE_TWO_PI};if(dot(F,a+c)<0.0)F=-F;
float l=length(F);if(!(l>0.0))return vec4(0.0);return vec4(F/l,max((l*l+dot(F,up))/(l+1.0),0.0));}
vec4 ltcTexel(int x,int y,int k){return texelFetch(ltcTable,ivec2(x*2+k,y),0);}
vec4 ltcLookup(float rough,float NdotV,int k){vec2 at=vec2(clamp(rough,0.0,1.0),sqrt(clamp(1.0-NdotV,0.0,1.0)))*float(LTC_SIZE-1);
ivec2 i=min(ivec2(at),ivec2(LTC_SIZE-2));vec2 f=at-vec2(i);vec4 low=mix(ltcTexel(i.x,i.y,k),ltcTexel(i.x+1,i.y,k),f.x);
return mix(low,mix(ltcTexel(i.x,i.y+1,k),ltcTexel(i.x+1,i.y+1,k),f.x),f.y);}
vec3 ltcCorner(vec3 q,vec3 T1,vec3 T2,vec3 N,vec4 m){float x=dot(q,T1),z=dot(q,N);return vec3(m.x*x+m.y*z,dot(q,T2),m.z*x+m.w*z);}
vec3 rectLight(vec4 positionRange,vec3 n,vec4 axis,vec4 colorIntensity,vec3 N,vec3 V,vec3 P,vec3 base,float metal,float rough){
vec3 C=positionRange.xyz,U=axis.xyz,W=normalize(cross(U,n))*axis.w;if(dot(P-C,n)<=0.0)return vec3(0.0);
float window=rangeWindow(length(C-P),positionRange.w);
vec3 a=C-U-W-P,b=C+U-W-P,c=C+U+W-P,d=C-U+W-P;float E=colorIntensity.w*PI*polygonFormFactor(a,b,c,d,N).w*window;if(E<=0.0)return vec3(0.0);
float NdotV=clamp(dot(N,V),1e-4,1.0);vec3 side=V-N*dot(N,V),other=cross(N,abs(N.x)>0.9?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0));
vec3 T1=normalize(dot(side,side)<1e-10?other:side),T2=cross(N,T1);vec4 m=ltcLookup(rough,NdotV,0),t=ltcLookup(rough,NdotV,1);
float lobe=polygonFormFactor(ltcCorner(a,T1,T2,N,m),ltcCorner(b,T1,T2,N,m),ltcCorner(c,T1,T2,N,m),ltcCorner(d,T1,T2,N,m),vec3(0.0,0.0,1.0)).w;
vec3 f0=mix(vec3(0.04),base,metal);vec3 specular=(f0*t.x+(vec3(1.0)-f0)*t.y)*lobe*colorIntensity.w*window;
return(base*(1.0-metal)/PI*E+specular)*colorIntensity.rgb;}`;
