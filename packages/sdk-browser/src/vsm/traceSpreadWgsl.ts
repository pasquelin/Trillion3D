/**
 * HOW FAR APART ON SCREEN A PIXEL'S RAYS FALL (`traceWgsl.ts`), every light's: a first ray hitting
 * an occluder whose rays all fall within one pixel stops its pixel there (`rayCountStatement`).
 * The host declares the view `vsmView`.
 */
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { FLOAT32_MAX } from '../../../math/src/wgsl/constants.ts'
import { frameAround } from '../../../math/src/wgsl/basis.ts'
import { perspectiveDivide } from '../../../math/src/wgsl/projection.ts'

export const VSM_TRACE_SPREAD_WGSL = wgslBlock(
  'VSM_TRACE_SPREAD_WGSL',
  [FLOAT32_MAX, frameAround, perspectiveDivide],
  `
/** A displacement \`e\` across the light (\`l\`), carried along the light onto the receiver's plane
 *  (normal \`n\`, \`nl\` = n·l > 0), then onto the screen in pixels: \`ndc\` and \`toPixels\` are the
 *  receiver's (\`vsmRaySpread\`). The plane's point is e − l (n·e)/(n·l); its screen offset is
 *  the derivative of clip.xy / clip.w, (Δclip.xy − ndc Δclip.w) / clip.w, exact for a perspective or
 *  an orthographic view, off-centre terms included. */
fn vsmAcrossLightOnScreen(e:vec3f,l:vec3f,n:vec3f,nl:f32,ndc:vec2f,toPixels:vec2f)->vec2f{
 let onPlane=e-l*(dot(n,e)/nl);
 let c=vsmView.viewToClip*vec4f((vsmView.shiftedToView*vec4f(onPlane,0.0)).xyz,0.0);
 return (c.xy-ndc*c.w)*toPixels;
}
/**
 * The screen pixels a world unit across the light \`l\` (unit, toward the light) spans at a receiver
 * of normal \`n\` seen at \`viewPosition\`: a displacement across the light reaches the receiver along
 * the light, then the screen (\`vsmAcrossLightOnScreen\`), a linear map whose largest stretch is the
 * root of the greatest eigenvalue of the 2×2 Gram matrix of the images of two orthonormal
 * directions across the light. A pixel's rays drawn in a cone of tangent τ, started within its
 * dither square of side d, lie at a distance h along the ray within 2·h·τ + √2·d of each other: on
 * screen, that times this. Where the receiver faces away from the light or is edge-on (n·l ≤ 0, or
 * not a number) the stretch is unbounded: f32's greatest value.
 */
fn vsmRaySpread(l:vec3f,n:vec3f,viewPosition:vec3f)->f32{
 let nl=dot(n,l);
 if(!(nl>0.0)){return FLOAT32_MAX;}
 let clip=vsmView.viewToClip*vec4f(viewPosition,1.0);
 let ndc=perspectiveDivide(clip).xy;
 let toPixels=0.5*vsmView.viewPixels.xy/clip.w;
 let across=frameAround(l);
 let a=vsmAcrossLightOnScreen(across.x,l,n,nl,ndc,toPixels);
 let b=vsmAcrossLightOnScreen(across.y,l,n,nl,ndc,toPixels);
 let g=vec3f(dot(a,a),dot(b,b),dot(a,b));
 let d=0.5*(g.x-g.y);
 return sqrt(0.5*(g.x+g.y)+sqrt(d*d+g.z*g.z));
}
`,
)
