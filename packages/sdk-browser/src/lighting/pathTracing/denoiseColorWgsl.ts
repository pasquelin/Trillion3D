import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { DN_DELTA_E_SCALE } from './denoiseParams.ts'

/**
 * COLOUR AND SAMPLING THE DENOISER'S KERNELS SHARE. `dnBilerp` and `dnBicubic` read a float texture that cannot be filtered (a 32-bit float image) at a level by hand: the bilinear read of four texels,
 * edges held, and the Catmull-Rom read of five bilinear taps. `dnDeltaE` is the CIE 2000 difference between two linear colours (through CIELAB, D65 white), `dnDistance` the error between two pixels
 * (`metric` 0 their luminance, 1 their colour distance, 2 the CIE 2000 difference; the first two after a 2.2 gamma), as a logarithm weighed against the length of the shift tried.
 */
export const DN_SAMPLING_WGSL = wgslBlock(
  'DN_SAMPLING_WGSL',
  [],
  `fn dnBilerp(t:texture_2d<f32>,level:i32,p:vec2f)->vec4f{
 let last=vec2i(textureDimensions(t,level))-vec2i(1);
 let base=floor(p);
 let f=p-base;
 let i=vec2i(base);
 let a=textureLoad(t,clamp(i,vec2i(0),last),level);
 let b=textureLoad(t,clamp(i+vec2i(1,0),vec2i(0),last),level);
 let c=textureLoad(t,clamp(i+vec2i(0,1),vec2i(0),last),level);
 let d=textureLoad(t,clamp(i+vec2i(1,1),vec2i(0),last),level);
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
fn dnBicubic(t:texture_2d<f32>,level:i32,uv:vec2f,size:vec2f)->vec4f{
 let inv=vec2f(1.0)/size;
 let pixel=uv*size;
 let corner=floor(pixel-vec2f(0.5))+vec2f(1.0);
 let f=pixel-corner;
 let f2=f*f;
 let twice=f+f;
 var tap=(vec2f(1.25)-f2)*f+vec2f(0.5);
 let t0=(0.25*f2-vec2f(0.0625))*(vec2f(1.125)-0.5*f2.yx);
 let w0=t0-twice*t0;
 let w3=t0+twice*t0;
 let centre=(corner-vec2f(0.5))*inv;
 tap=tap*inv;
 let w2=1.0-w0.x-w3.x-w0.y-w3.y;
 var sum=dnBilerp(t,level,(centre+vec2f(-inv.x,tap.y))*size-vec2f(0.5))*w0.x;
 sum+=dnBilerp(t,level,(centre+vec2f(2.0*inv.x,tap.y))*size-vec2f(0.5))*w3.x;
 sum+=dnBilerp(t,level,(centre+tap)*size-vec2f(0.5))*w2;
 sum+=dnBilerp(t,level,(centre+vec2f(tap.x,-inv.y))*size-vec2f(0.5))*w0.y;
 sum+=dnBilerp(t,level,(centre+vec2f(tap.x,2.0*inv.y))*size-vec2f(0.5))*w3.y;
 return sum;
}`,
)

export const DN_COLOR_WGSL = wgslBlock(
  'DN_COLOR_WGSL',
  [luminance],
  `const DN_DELTA_E_SCALE:f32=${DN_DELTA_E_SCALE};
const DN_PI:f32=3.1415926535897932;
fn dnLab(rgb:vec3f)->vec3f{
 let xyz=vec3f(
  dot(rgb,vec3f(0.4123907993,0.3575843394,0.1804807884)),
  dot(rgb,vec3f(0.2126390059,0.7151686788,0.0721923154)),
  dot(rgb,vec3f(0.0193308187,0.1191947798,0.9505321522)))/vec3f(0.9504559271,1.0,1.0890577508);
 let cubed=0.00885645167;
 let lin=xyz/(3.0*0.04280618311)+vec3f(4.0/29.0);
 let f=select(lin,pow(max(xyz,vec3f(cubed)),vec3f(1.0/3.0)),xyz>vec3f(cubed));
 return vec3f(116.0*f.y-16.0,500.0*(f.x-f.y),200.0*(f.y-f.z));
}
fn dnLch(lab:vec3f)->vec3f{
 var hue=0.0;
 if(lab.z!=0.0||lab.y!=0.0){
  hue=atan2(lab.z,lab.y)*180.0/DN_PI;
  if(hue<0.0){hue+=360.0;}
 }
 return vec3f(lab.x,length(lab.yz),hue);
}
fn dnCosDeg(d:f32)->f32{return cos(d*DN_PI/180.0);}
fn dnSinDeg(d:f32)->f32{return sin(d*DN_PI/180.0);}
fn dnPow7(x:f32)->f32{let x2=x*x;return x2*x2*x2*x;}
fn dnDeltaE2000(lab0:vec3f,lab1:vec3f)->f32{
 let lch0=dnLch(lab0);
 let lch1=dnLch(lab1);
 let dL=lab1.x-lab0.x;
 let lBar=(lab1.x+lab0.x)*0.5;
 let cBar=(lch0.y+lch1.y)*0.5;
 let c7=dnPow7(cBar);
 let g=0.5*(1.0-sqrt(c7/(c7+6103515625.0)));
 let a1=lab0.y*(1.0+g);
 let a2=lab1.y*(1.0+g);
 let p0=dnLch(vec3f(lab0.x,a1,lab0.z));
 let p1=dnLch(vec3f(lab1.x,a2,lab1.z));
 let cBarP=(p0.y+p1.y)*0.5;
 let dCP=p1.y-p0.y;
 let h1=p0.z;
 let h2=p1.z;
 let hDiff=abs(h1-h2);
 var dhP=h2-h1;
 if(hDiff>180.0){dhP=select(h2-h1-360.0,h2-h1+360.0,h2<=h1);}
 if(p0.y==0.0||p1.y==0.0){dhP=0.0;}
 let dHP=2.0*sqrt(p0.y*p1.y)*dnSinDeg(dhP*0.5);
 let hSum=h1+h2;
 var hBar=hSum*0.5;
 if(hDiff>180.0){hBar=select((hSum-360.0)*0.5,(hSum+360.0)*0.5,hSum<360.0);}
 if(p0.y==0.0||p1.y==0.0){hBar=hSum;}
 let t=1.0-0.17*dnCosDeg(hBar-30.0)+0.24*dnCosDeg(2.0*hBar)+0.32*dnCosDeg(3.0*hBar+6.0)-0.20*dnCosDeg(4.0*hBar-63.0);
 let l50=(lBar-50.0)*(lBar-50.0);
 let sL=1.0+0.015*l50/sqrt(20.0+l50);
 let sC=1.0+0.045*cBarP;
 let sH=1.0+0.015*cBarP*t;
 let cp7=dnPow7(cBarP);
 let comp=sqrt(cp7/(cp7+6103515625.0));
 let arg=(hBar-275.0)/25.0;
 let rT=-2.0*comp*dnSinDeg(60.0*exp(-arg*arg));
 let cc=dCP/sC;
 let hh=dHP/sH;
 let l=dL/sL;
 return sqrt(max(l*l+cc*cc+hh*hh+rT*cc*hh,0.0));
}
fn dnDeltaE(a:vec3f,b:vec3f)->f32{return dnDeltaE2000(dnLab(a),dnLab(b))*DN_DELTA_E_SCALE;}
fn dnDistance(a:vec3f,b:vec3f,shift:vec2i,metric:u32)->f32{
 var x=a;
 var y=b;
 if(metric<2u){
  x=pow(abs(x),vec3f(1.0/2.2));
  y=pow(abs(y),vec3f(1.0/2.2));
 }
 var first=0.0;
 var second=0.0;
 if(metric==0u){first=luminance(x);second=luminance(y);}
 else if(metric==1u){first=length(x-y);}
 else{first=dnDeltaE(x,y);}
 return log2(2.0+abs(first-second))*(2.0-exp(-0.02*f32(dot(shift,shift))));
}`,
)
