/**
 * THE LEVEL OF DETAIL OF THE CUT, in WGSL: the screen reach of an error, as the published design
 * measures it.
 *
 * A sphere's PROJECTED EDGE SCALES (`edgeScales`) are, over the sphere, the smallest and the
 * largest of its points' view depth times the cosine of their angle to the view axis — the near
 * plane taking a point that passes it —: an edge of length `L` at a point of scale `s` spans
 * `L · F / s` pixels, `F` the view's pixels per unit at unit depth on its vertical axis
 * (`viewPixels`, half the projection's vertical scale times the view's height in pixels). An
 * orthographic view's scales are one. A placement's sphere is scaled by the largest of its axes'
 * scales, an error by the smallest (`placedScale`, `primitiveWgsl.ts`). A deformation moves no LOD
 * ball and adds to no error: a deformed placement is cut at its rest pose's balls and errors, only
 * its boxes follow it.
 *
 * Every comparison is the LOD scale's, `F / t` at the threshold `t` (`pixelError`, the pixels an
 * edge may span), multiplied out: an error `E` at edge scale `s` SHOWS when `s <= F · scale · E / t`,
 * written `s · t <= F · scale · E` so a zero threshold keeps every error that is not zero
 * (`errorShows`). A node is needed while the error its subtree replaces shows; a leaf's floor is
 * kept while it shows at its largest scale (`floorWgsl.ts`); a cluster is fine enough while its own
 * error does not show (`clusterRule`). A request's priority is the replaced error's reach over the
 * threshold (`leafPriority`), the request's priority word its float's bits (`requestPriority`).
 */
import { DAG_INF } from './infDecl.ts'
import { CUT_RULE_WGSL } from '../../cut/rule.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { transformPoint } from '../../../../../math/src/wgsl/projection.ts'
import { REQUEST_CATEGORY, REQUEST_PRIORITY_MAX, REQUEST_PRIORITY_MIN } from '../request/request.ts'

/** A request's priority word of category `category` (the top two bits) for priority `p`, the float's
 *  bits below them, within the range the host's heap keeps (`../request/request.ts`): the camera's
 *  (`requestPriority`) and a shadow view's (`../../../lighting/shadows/vsm/traversal/`). */
export const requestPriorityOf = (category: number, p: string) =>
  `clamp((${category}u<<30u)|(bitcast<u32>(${p})>>2u),${REQUEST_PRIORITY_MIN}u,${REQUEST_PRIORITY_MAX}u)`

/** The projected edge scales of a view (`edgeScalesAt`), the camera's cut and the shadow views' alike. */
export const DAG_EDGE_SCALES_WGSL = wgslBlock(
  'DAG_EDGE_SCALES_WGSL',
  [],
  `
/** The projected edge scales of a sphere of view-space centre \`c\` and radius \`r\`, the eye at zero
 *  looking down \`-z\`: the smallest and the largest, over the sphere, of a point's depth times the
 *  cosine of its angle to the axis, the near plane taking the points past it; none (zero) for a
 *  sphere wholly behind the near plane; one for an orthographic view. \`near\` is the view's near plane,
 *  \`perspective\` whether it is a perspective view. The camera's (\`edgeScales\`) and the shadow views'
 *  (\`vsmRenderEdgeScales\`) alike. */
fn edgeScalesAt(c:vec3f,r:f32,near:f32,perspective:bool)->vec2f{
 if(!perspective){return vec2f(1.0);}
 let distSq=dot(c,c);let z=-c.z;
 let axisSq=distSq-z*z;let axis=sqrt(max(0.0,axisSq));
 let tangentSq=distSq-r*r;let tangent=sqrt(max(0.0,tangentSq));
 let unit=1.0/distSq;
 var bottom=(r*axis+tangent*z)*unit;
 var top=(-r*axis+tangent*z)*unit;
 let h=near-z;
 if(tangentSq<0.0||bottom*tangent<near){let across=max(axis-sqrt(r*r-h*h),0.0);bottom=near*inverseSqrt(across*across+near*near);}
 if(tangentSq<0.0||top*tangent<near){let across=axis+sqrt(r*r-h*h);top=near*inverseSqrt(across*across+near*near);}
 let reachesAxis=r*r-axisSq>=max(h,0.0)*max(h,0.0);
 let minZ=max(z-r,near);let maxZ=max(z+r,near);
 if(z+r>near){return vec2f(minZ*top,maxZ*select(bottom,1.0,reachesAxis));}
 return vec2f(0.0);
}
`,
)

export const DAG_ERROR_WGSL = wgslBlock(
  'DAG_ERROR_WGSL',
  [DAG_INF, CUT_RULE_WGSL, DAG_EDGE_SCALES_WGSL, transformPoint],
  `
/** The view's pixels per unit at unit depth on its vertical axis. */
fn viewPixels()->f32{return cutView.pixelScale.y;}
/** The projected edge scales of the camera's view for a sphere of view-space centre \`c\` and radius
 *  \`r\` (\`edgeScalesAt\`). */
fn edgeScales(c:vec3f,r:f32)->vec2f{
 return edgeScalesAt(c,r,cutView.near,cutView.perspective>0.0);
}
/** The edge scales of sphere \`sphere\` of the placement read last (\`viewWorld\` made \`e\`), its
 *  radius scaled by the placement's largest axis scale. */
fn sphereEdges(sphere:vec4f,e:mat4x4f)->vec2f{
 return edgeScales(transformPoint(e,sphere.xyz),sphere.w*placedScale.y);
}
/** Whether an error \`error\` of the placement read last, at edge scale \`edge\`, shows at the
 *  threshold: \`edge <= (F / t) · scale · error\`, the threshold multiplied out; a zero error never. */
fn errorShows(edge:f32,error:f32)->bool{
 return error>0.0&&edge*cutView.pixelError<=viewPixels()*placedScale.x*error;
}
/** The cut rule's two comparisons on a cluster (\`../../cut/rule.ts\`): the error it replaces shows
 *  (\`x\`: no parent, or the parent's error at its sphere shows), and its own does not (\`y\`). */
fn clusterRule(cluster:Cluster,e:mat4x4f)->vec2<bool>{
 let parent=cluster.parentError;
 let parentShows=parent<0.0||errorShows(sphereEdges(cluster.parentSphere,e).x,parent);
 return vec2<bool>(parentShows,!errorShows(sphereEdges(cluster.sphere,e).x,cluster.lodError));
}
/** A request's priority word: the category of the view in the top two bits, the priority's float
 *  bits below them, within the range the host's heap keeps (\`../request/request.ts\`). */
fn requestPriority(p:f32)->u32{
 return ${requestPriorityOf(REQUEST_CATEGORY, 'p')};
}
/** A kept leaf's priority: the error its pages replace, its reach over the threshold — \`F · scale ·
 *  error / (t · edge)\`, one or more for a leaf the cut needs —; unbounded without a ceiling. */
fn leafPriority(node:CullNode,e:mat4x4f)->u32{
 let reach=viewPixels()*placedScale.x*node.maxParentError/(cutView.pixelError*sphereEdges(node.sphere,e).x);
 return requestPriority(select(INF,reach,node.maxParentError>=0.0));
}
`,
)
