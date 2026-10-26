import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32, wgslMatrix3, wgslVec3 } from '../../../../math/src/wgsl/number.ts'
import { FILM } from '../filmCurveConstants.ts'
import { CONES_TO_XYZ, MODEL, XYZ_TO_CONES, type V3 } from './acesCam.ts'
import { DISPLAY_VIEW, LIGHT_VIEW, TRANSFORM } from './acesDisplay.ts'
import { SDR_TABLES } from './acesTables.ts'

/** A list of numbers as WGSL literals. */
const list = (values: readonly number[]) => values.map(wgslF32).join(',')

/** The model's numbers as WGSL literals, and the viewing conditions' and the transform's. */
const M = MODEL
const T = TRANSFORM
const S = T.scale

/**
 * The hue tables as constant arrays, read by a runtime index: the grading gamut's reach, the
 * display gamut's cusp as lightness, colourfulness and hue, and the curvature of its upper face
 * (`acesTables.ts`). Constants of the one display, the shader holds them as literals.
 */
const ACES_TABLES_WGSL = wgslBlock(
  'ACES_TABLES_WGSL',
  [],
  `
const acesReach=array<f32,360>(${list(SDR_TABLES.reach)});
const acesCusp=array<vec3f,362>(${SDR_TABLES.cusp.map((c: V3) => wgslVec3(c)).join(',')});
const acesGamma=array<f32,362>(${list(SDR_TABLES.gamma)});`,
)

/**
 * The appearance model's functions (`acesCam.ts`): the response's compression and its undoing, a
 * colour's lightness, colourfulness and hue under the light's viewing condition (`acesToJmh`, its
 * tristimulus values in nits) and the colour of a lightness, colourfulness and hue under the
 * display's (`acesFromJmh`), and the lightness of a luminance and back. Each of the conditions' scales
 * and achromatic responses is a literal, made once on the processor.
 */
const ACES_MODEL_WGSL = wgslBlock(
  'ACES_MODEL_WGSL',
  [],
  `
fn acesCompress(c:vec3f)->vec3f{
 let v=pow(${wgslF32(M.level)}*abs(c)*0.01,vec3f(${wgslF32(M.power)}));
 return sign(c)*${wgslF32(M.ceiling)}*v/(vec3f(${wgslF32(M.offset)})+v);
}
fn acesExpand(c:vec3f)->vec3f{
 let a=abs(c);
 let base=max(${wgslF32(M.offset)}*a/(vec3f(${wgslF32(M.ceiling)})-a),vec3f(0.0));
 return sign(c)*(${wgslF32(100 / M.level)})*pow(base,vec3f(${wgslF32(1 / M.power)}));
}
fn acesWrapHue(h:f32)->f32{return h-360.0*floor(h/360.0);}
fn acesToJmh(xyz:vec3f)->vec3f{
 let r=acesCompress(${wgslVec3(LIGHT_VIEW.d)}*(${wgslMatrix3(XYZ_TO_CONES)}*xyz));
 let a=r.x-12.0*r.y/11.0+r.z/11.0;
 let o=(r.x+r.y-2.0*r.z)/9.0;
 var hue=0.0;
 if(a!=0.0||o!=0.0){hue=57.29577951308232*atan2(o,a);}
 let lightness=100.0*pow(max((${wgslF32(M.redWeight)}*r.x+r.y+${wgslF32(M.blueWeight)}*r.z)/${wgslF32(LIGHT_VIEW.aw)},0.0),${wgslF32(M.surroundJ * LIGHT_VIEW.z)});
 return vec3f(lightness,select(43.0*${wgslF32(M.surroundM)}*length(vec2f(a,o)),0.0,lightness==0.0),acesWrapHue(hue));
}
fn acesFromJmh(jmh:vec3f)->vec3f{
 let response=${wgslF32(DISPLAY_VIEW.aw)}*pow(max(jmh.x/100.0,0.0),${wgslF32(1 / (M.surroundJ * DISPLAY_VIEW.z))});
 let gamma=jmh.y/${wgslF32(43 * M.surroundM)};
 let a=gamma*cos(jmh.z*0.017453292519943295);
 let o=gamma*sin(jmh.z*0.017453292519943295);
 let adapted=vec3f(460.0*response+451.0*a+288.0*o,460.0*response-891.0*a-261.0*o,460.0*response-220.0*a-6300.0*o)/1403.0;
 return ${wgslMatrix3(CONES_TO_XYZ)}*(acesExpand(adapted)/${wgslVec3(DISPLAY_VIEW.d)});
}
fn acesYToJ(y:f32)->f32{
 let v=pow(${wgslF32(M.level)}*abs(y)*0.01,${wgslF32(M.power)});
 let response=${wgslF32(M.ceiling)}*v/(${wgslF32(M.offset)}+v);
 return sign(y)*100.0*pow(response/${wgslF32(M.white)},${wgslF32(M.surroundJ * M.greyZ)});
}
fn acesJToY(j:f32)->f32{
 let a=${wgslF32(M.white)}*pow(abs(j)/100.0,${wgslF32(1 / (M.surroundJ * M.greyZ))});
 return sign(j)*${wgslF32(100 / M.level)}*pow(${wgslF32(M.offset)}*a/(${wgslF32(M.ceiling)}-a),${wgslF32(1 / M.power)});
}
fn acesToneScale(x:f32)->f32{
 let f=${wgslF32(S.m2)}*pow(max(0.0,x)/(x+${wgslF32(S.s2)}),${wgslF32(S.g)});
 return max(0.0,f*f/(f+${wgslF32(S.t1)}))*${wgslF32(S.nr)};
}`,
)

/**
 * The two compressions (`acesHull.ts`): `acesChroma` the colourfulness of a colour after the tone
 * scale moved its lightness from `orig`, `acesMapGamut` the colour pulled into the display's gamut
 * along its projection line. `acesReach`, `acesCusp` and `acesUpperGamma` read the hue tables
 * (`ACES_TABLES_WGSL`) the way the processor does, the reach's weight the distance past the lower
 * whole degree all round the circle, the wrap included.
 */
const ACES_HULL_WGSL = wgslBlock(
  'ACES_HULL_WGSL',
  [ACES_TABLES_WGSL],
  `
fn acesSlot(h:f32)->i32{return i32(floor(acesWrapHue(h)));}
fn acesReachAt(h:f32)->f32{
 let hue=acesWrapHue(h);
 let low=i32(floor(hue));
 return mix(acesReach[low],acesReach[(low+1)%360],hue-f32(low));
}
fn acesCuspAt(h:f32)->vec2f{
 var low=0;
 var high=361;
 var at=acesSlot(h)+1;
 while(low+1<high){
  if(h>acesCusp[at].z){low=at;}else{high=at;}
  at=(low+high)/2;
 }
 let lo=acesCusp[high-1];
 let hi=acesCusp[high];
 let t=(h-lo.z)/(hi.z-lo.z);
 return vec2f(mix(lo.x,hi.x,t),mix(lo.y,hi.y,t));
}
fn acesUpperGamma(h:f32)->f32{
 let low=acesSlot(h)+1;
 return mix(acesGamma[low],acesGamma[(low+1)%362],acesWrapHue(h)-f32(low-1));
}
fn acesToe(x:f32,limit:f32,k1:f32,k2:f32)->f32{
 if(x>limit){return x;}
 let shape=max(k2,0.001);
 let size=length(vec2f(k1,shape));
 let scale=(limit+size)/(limit+shape);
 let b=scale*x-size;
 return 0.5*(b+sqrt(b*b+4.0*shape*scale*x));
}
fn acesNorm(h:f32)->f32{
 let a=cos(h*0.017453292519943295);
 let b=sin(h*0.017453292519943295);
 let cos2=a*a-b*b;
 let sin2=2.0*a*b;
 let cos3=4.0*a*a*a-3.0*a;
 let sin3=3.0*b-4.0*b*b*b;
 return ${wgslF32(T.norm)}*(11.34072*a+16.46899*cos2+7.8838*cos3+14.66441*b-6.37224*sin2+9.19364*sin3+77.12896);
}
fn acesChroma(jmh:vec3f,orig:f32)->f32{
 if(jmh.y==0.0){return jmh.y;}
 let nj=jmh.x/${wgslF32(T.limitJ)};
 let snj=max(0.0,1.0-nj);
 let norm=acesNorm(jmh.z);
 let limit=pow(nj,${wgslF32(T.modelGamma)})*acesReachAt(jmh.z)/norm;
 var m=jmh.y*pow(jmh.x/orig,${wgslF32(T.modelGamma)})/norm;
 m=limit-acesToe(limit-m,limit-0.001,snj*${wgslF32(T.sat)},sqrt(nj*nj+${wgslF32(T.satThr)}));
 return acesToe(m,limit,nj*${wgslF32(T.compr)},snj)*norm;
}
fn acesRoll(v:f32,thr:f32,lim:f32)->f32{
 if(v<thr||lim<=1.0001){return v;}
 let s=(lim-thr)*(1.0-thr)/(lim-1.0);
 let nd=(v-thr)/s;
 return thr+s*nd/(1.0+nd);
}
fn acesFocusGain(j:f32,cuspJ:f32)->f32{
 let thr=mix(cuspJ,${wgslF32(T.limitJ)},0.3);
 if(j<=thr){return 1.0;}
 return pow(log2((${wgslF32(T.limitJ)}-thr)/max(0.0001,${wgslF32(T.limitJ)}-j))*0.30102999566398114,${wgslF32(1 / 0.55)})+1.0;
}
fn acesAxisCrossing(j:f32,m:f32,focusJ:f32,slopeGain:f32)->f32{
 let a=m/(focusJ*slopeGain);
 let below=j<focusJ;
 let b=select(-(1.0+m/slopeGain+${wgslF32(T.limitJ)}*m/(focusJ*slopeGain)),1.0-m/slopeGain,below);
 let c=select(${wgslF32(T.limitJ)}*m/slopeGain+j,-j,below);
 let root=sqrt(b*b-4.0*a*c);
 return 2.0*c/select(-b+root,-b-root,below);
}
fn acesLineSlope(axis:f32,focusJ:f32,slopeGain:f32)->f32{
 return select(${wgslF32(T.limitJ)}-axis,axis,axis<focusJ)*(axis-focusJ)/(focusJ*slopeGain);
}
fn acesSmoothMin(a:f32,b:f32,s:f32)->f32{
 let h=max(s-abs(a-b),0.0)/s;
 return min(a,b)-h*h*h*s/6.0;
}
fn acesEdge(source:vec2f,cusp:vec2f,focusJ:f32,slopeGain:f32,gammaTop:f32)->vec3f{
 let cuspM=cusp.y*${wgslF32(1 + 0.27 * 0.12)};
 let axis=acesAxisCrossing(source.x,source.y,focusJ,slopeGain);
 let cuspAxis=acesAxisCrossing(cusp.x,cuspM,focusJ,slopeGain);
 let slope=acesLineSlope(axis,focusJ,slopeGain);
 let lower=cuspAxis*pow(axis/cuspAxis,${wgslF32(1 / T.lowerGamma)})/(cusp.x/cuspM-slope);
 let upper=cuspM*(${wgslF32(T.limitJ)}-cuspAxis)*pow((${wgslF32(T.limitJ)}-axis)/(${wgslF32(T.limitJ)}-cuspAxis),1.0/gammaTop)/(slope*cuspM+${wgslF32(T.limitJ)}-cusp.x);
 let m=cuspM*acesSmoothMin(lower/cuspM,upper/cuspM,0.12);
 return vec3f(axis+slope*m,m,axis);
}
fn acesReachEdge(edge:vec2f,h:f32,cuspJ:f32,focusJ:f32)->f32{
 let reach=acesReachAt(h);
 let slopeGain=${wgslF32(T.limitJ * T.focus)}*acesFocusGain(edge.x,cuspJ);
 let axis=acesAxisCrossing(edge.x,edge.y,focusJ,slopeGain);
 let slope=acesLineSlope(axis,focusJ,slopeGain);
 return ${wgslF32(T.limitJ)}*pow(axis/${wgslF32(T.limitJ)},${wgslF32(T.modelGamma)})*reach/(${wgslF32(T.limitJ)}-slope*reach);
}
fn acesMapGamut(jmh:vec3f)->vec3f{
 if(jmh.y<0.0001||jmh.x>${wgslF32(T.limitJ)}){return vec3f(jmh.x,0.0,jmh.z);}
 let cusp=acesCuspAt(jmh.z);
 let focusJ=mix(cusp.x,${wgslF32(T.midJ)},min(1.0,1.3-cusp.x/${wgslF32(T.limitJ)}));
 let slopeGain=${wgslF32(T.limitJ * T.focus)}*acesFocusGain(jmh.x,cusp.x);
 let edge=acesEdge(jmh.xy,cusp,focusJ,slopeGain,acesUpperGamma(jmh.z));
 let reach=acesReachEdge(edge.xy,jmh.z,cusp.x,focusJ);
 let difference=max(1.0001,reach/edge.y);
 let v=acesRoll(jmh.y/edge.y,max(0.75,1.0/difference),difference);
 return vec3f(edge.z+v*(edge.x-edge.z),v*edge.y,jmh.z);
}`,
)

/**
 * The standard output transform for the display the engine has (`acesDisplay.ts`): `acesDisplay`
 * takes a light in the grading gamut and the scene's multiplier to the linear sRGB colour in
 * [0, 1] the display shows. The light — cut to the table's range before (`displayLight`,
 * `../toneBakeWgsl.ts`) — is multiplied and cut to what the transform reads, put through
 * the tone scale on its lightness (`acesToneScale`), its colourfulness compressed
 * (`acesChroma`) and the colour pulled into the display's gamut (`acesMapGamut`), then taken
 * to sRGB's primaries and cut.
 */
export const STANDARD_OUTPUT_WGSL = wgslBlock(
  'STANDARD_OUTPUT_WGSL',
  [ACES_MODEL_WGSL, ACES_HULL_WGSL],
  `
fn acesDisplay(light:vec3f,multiplier:f32)->vec3f{
 let scene=clamp(light*multiplier,vec3f(0.0),vec3f(1024.0));
 let jmh=acesToJmh(100.0*(${FILM.wgsl.ap1ToXyz}*scene));
 let lightness=acesYToJ(acesToneScale(acesJToY(jmh.x)*0.01));
 let tone=vec3f(lightness,acesChroma(vec3f(lightness,jmh.y,jmh.z),jmh.x),jmh.z);
 let inside=acesMapGamut(tone);
 return clamp(${FILM.wgsl.xyzToSrgb}*acesFromJmh(inside)*0.01,vec3f(0.0),vec3f(1.0));
}`,
)
