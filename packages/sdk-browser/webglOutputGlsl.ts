/**
 * The display chain's last two links, in GLSL, shared by every engine program that writes a
 * displayed colour: the filmic curve of the reference (ACES, its 0.6 exposure scale folded in)
 * and the sRGB transfer. One text, so that two programs never encode the same colour twice.
 */
export const OUTPUT_TRANSFER_GLSL = `vec3 aces(vec3 c){c/=0.6;c=mat3(0.59719,0.07600,0.02840,0.35458,0.90834,0.13383,0.04823,0.01566,0.83777)*c;
vec3 a=c*(c+0.0245786)-0.000090537,b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
return clamp(mat3(1.60475,-0.10208,-0.00327,-0.53108,1.10813,-0.07276,-0.07367,-0.00605,1.07602)*c,0.0,1.0);}
vec3 linearToSrgb(vec3 x){bvec3 low=lessThanEqual(x,vec3(0.0031308));return mix(1.055*pow(max(x,vec3(0.0)),vec3(1.0/2.4))-0.055,12.92*x,low);}`;
