/**
 * Screen error of the DAG selection kernel, in WGSL: sdk-core's `screenErrorBound` (proof at the
 * formula site, `screenErrorBound.ts`), same operands and same order, in f32. CPU mirror:
 * `projectedError` from `../oracle/math.fixture.ts`. WGSL module declarations are read in any order:
 * this fragment is added to the text of `shader.ts`.
 *
 * `REFERENCE_ERROR` is the EXPERIMENT switch described in `screenErrorVariant.ts`: a module
 * constant, false in the shipped text — the default shader is therefore unchanged, the branch
 * being eliminated at compile time. `withScreenErrorVariant` sets it true for the campaign that
 * measures the external-reference metric, exact mirror of `referenceScreenError`.
 */
import { CLUSTER_LEVEL_SHIFT } from '../clusterFlags.ts'
import type { ScreenErrorVariant } from '../../../../../sdk-core/src/index.ts'
import { PROJECTED_BOUND_WGSL } from './projectedBoundWgsl.ts'
import { REFERENCE_ERROR_DECL } from './referenceErrorDecl.ts'

export const DAG_ERROR_WGSL = `
${REFERENCE_ERROR_DECL}
${PROJECTED_BOUND_WGSL}
/** Upper bound of the screen displacement of any point of the sphere, grown by the primitive's
 *  deformation reach (\`deformReach\`, #357), moved by at most \`error\`:
 *  minimum depth m, distance to the axis l, radius and error stretched rho and delta, written on
 *  the clip weight w = p*depth+(1-p) of the projection (\`views[vi].perspective\`, p):
 *  E = (delta*f/w(m))*(sqrt(w(m)^2+(p*(l+rho))^2)/w(m-delta)) ; near plane reached: INF.
 *  Under \`REFERENCE_ERROR\`, the plain projection: delta*f/w(depth). */
fn projected(error:f32,sphere:vec4f,e:mat4x4f,stretch:f32,focal:f32)->f32{
 if(error==0.0){return 0.0;}
 if(!(error>0.0)){return INF;}
 let v=(e*vec4f(sphere.xyz,1.0)).xyz;
 return projectedBound(error,v,sphere.w+deformReach,stretch,focal,views[vi].near,views[vi].perspective,REFERENCE_ERROR);
}
/** The two screen errors the cut rule compares, projected once: its replacement's (\`x\`, the
 *  parent's) and its own (\`y\`). */
fn clusterPixels(cluster:Cluster,e:mat4x4f,stretch:f32,focal:f32)->vec2f{
 let own=cluster.lodError+select(0.0,2.0*deformReach,(cluster.flags>>${CLUSTER_LEVEL_SHIFT}u)>0u);
 let parent=select(cluster.parentError,cluster.parentError+2.0*deformReach,cluster.parentError>=0.0);
 return vec2f(projected(parent,cluster.parentSphere,e,stretch,focal),projected(own,cluster.sphere,e,stretch,focal));
}
/** The cluster the cut wants at \`threshold\`, on its \`clusterPixels\`: the rule with everything resident. */
fn selects(pixels:vec2f,threshold:f32)->bool{return drawsCluster(true,pixels.x,pixels.y,true,threshold);}
fn focalPixels()->f32{return max(views[vi].pixelScale.x,views[vi].pixelScale.y);}
`

/**
 * Shader text for a given variant: returned as-is for ours, a single declaration returned for
 * the external-reference one. Nothing else changes by a character.
 */
export function withScreenErrorVariant(code: string, variant: ScreenErrorVariant): string {
  if (variant !== 'reference') return code
  const at = code.indexOf(REFERENCE_ERROR_DECL)
  if (at < 0) throw new Error('REFERENCE_ERROR declaration missing from the shader')
  return (
    code.slice(0, at) +
    'const REFERENCE_ERROR:bool=true;' +
    code.slice(at + REFERENCE_ERROR_DECL.length)
  )
}
