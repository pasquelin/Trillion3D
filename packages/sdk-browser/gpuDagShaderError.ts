/**
 * Screen error of the DAG selection kernel, in WGSL: sdk-core's `screenErrorBound` (proof at the
 * formula site, `screenErrorBound.ts`), same operands and same order, in f32. CPU mirror:
 * `projectedError` from `gpuDagOracleMath.ts`. WGSL module declarations are read in any order:
 * this fragment is added to the text of `gpuDagShader.ts`.
 *
 * `REFERENCE_ERROR` is the EXPERIMENT switch described in `screenErrorVariant.ts`: a module
 * constant, false in the shipped text — the default shader is therefore unchanged, the branch
 * being eliminated at compile time. `withScreenErrorVariant` sets it true for the campaign that
 * measures the external-reference metric, exact mirror of `referenceScreenError`.
 */
import type { ScreenErrorVariant } from '../sdk-core/index.ts';

/** Declaration `withScreenErrorVariant` returns, written once for both. */
export const REFERENCE_ERROR_DECL = 'const REFERENCE_ERROR:bool=false;';

export const DAG_ERROR_WGSL = `
${REFERENCE_ERROR_DECL}
/** Upper bound of the screen displacement of any point of the sphere moved by at most \`error\`:
 *  minimum depth m, distance to the axis l, radius and error stretched rho and delta, written on
 *  the clip weight w = p*depth+(1-p) of the projection (\`uni.perspective\`, p):
 *  E = (delta*f/w(m))*(sqrt(w(m)^2+(p*(l+rho))^2)/w(m-delta)) ; near plane reached: INF.
 *  Under \`REFERENCE_ERROR\`, the external reference's simple projection: delta*f/w(depth). */
fn projected(error:f32,sphere:vec4f,e:mat4x4f,stretch:f32,focal:f32)->f32{
 if(error==0.0){return 0.0;}
 if(!(error>0.0)){return INF;}
 let v=(e*vec4f(sphere.xyz,1.0)).xyz;
 let p=uni.perspective;let flat=1.0-p;
 if(REFERENCE_ERROR){
  let depth=p*-v.z+flat;
  if(!(depth>p*uni.near)){return INF;}
  let delta=error*stretch;
  return (delta*focal)/depth;
 }
 let reach=sphere.w*stretch;let shift=error*stretch;
 let nearest=p*(-v.z-reach)+flat;let closest=nearest-p*shift;let side=p*(sqrt(v.x*v.x+v.y*v.y)+reach);
 if(!(closest>p*uni.near)){return INF;}
 let slant=sqrt(nearest*nearest+side*side);
 if(!(slant>=nearest&&slant<INF)){return INF;}
 return ((shift*focal)/nearest)*(slant/closest);
}
fn selects(cluster:Cluster,e:mat4x4f,stretch:f32,focal:f32,threshold:f32)->bool{
 if(projected(cluster.lodError,cluster.sphere,e,stretch,focal)>threshold){return false;}
 return projected(cluster.parentError,cluster.parentSphere,e,stretch,focal)>threshold;
}
fn focalPixels()->f32{return max(uni.pixelScale.x,uni.pixelScale.y);}
`;

/**
 * Shader text for a given variant: returned as-is for ours, a single declaration returned for
 * the external-reference one. Nothing else changes by a character.
 */
export function withScreenErrorVariant(code: string, variant: ScreenErrorVariant): string {
  if (variant !== 'reference') return code;
  const at = code.indexOf(REFERENCE_ERROR_DECL);
  if (at < 0) throw new Error('REFERENCE_ERROR declaration missing from the shader');
  return (
    code.slice(0, at) +
    'const REFERENCE_ERROR:bool=true;' +
    code.slice(at + REFERENCE_ERROR_DECL.length)
  );
}
