/**
 * The frustum test of a box, written once: true when the box lies behind one of the six planes
 * `plane(i)` names (a view with no far plane sends the plane every box passes, `frustum.ts`); never
 * when the host turned the frustum's cull off (`CULL_FRUSTUM_OFF`, `viewsWgsl.ts`). The planes
 * come from the view's own words (`outsideView`) or brought into a primitive's space
 * (`outsideFrustum`, `primitiveWgsl.ts`); WGSL has no function value, so the getter is an expression.
 */
export const outsidePlanesFn = (
  name: string,
  lead: string,
  plane: (i: string) => string,
) => `fn ${name}(${lead}lo:vec3f,hi:vec3f)->bool{
 if(cullOff(CULL_FRUSTUM_OFF)){return false;}
 for(var i=0u;i<6u;i++){if(boxBehindPlane(${plane('i')},lo,hi)){return true;}}
 return false;
}`
