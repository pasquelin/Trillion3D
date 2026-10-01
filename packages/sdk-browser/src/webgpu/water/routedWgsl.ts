import { FLAG_UNLIT_VIEW } from '../../visibility/buffer.ts';
import { DISPLAY_ROUTE_WGSL, displayMaskWgsl } from '../blend/displayFilter.ts';
import { waterCompositeShader } from './compositeWgsl.ts';

/** With display layers (`../blend/displayFilter.ts`): masked, tint and added value as a normal
 *  layer's; then the reactive value (`historyWgsl.ts`), green alone at the water's coverage. */
export const waterRoutedShader = (
  pages?: number,
  unbounded = false,
) => `${waterCompositeShader(pages, unbounded)}${DISPLAY_ROUTE_WGSL}${displayMaskWgsl(2)}
struct Routed{@location(0) color:vec4f,@location(1) tint:vec4f,@location(2) add:vec4f,}
struct RoutedReactive{@location(0) color:vec4f,@location(1) tint:vec4f,@location(2) add:vec4f,@location(3) reactive:vec4f,}
fn waterRoute(pixel:vec4f,c:vec4f)->Route{
 let unlit=(uni.viewFlags&${FLAG_UNLIT_VIEW}u)!=0u;
 return displayRoute(c.rgb,uni.exposure,uni.toneCurve,unlit,c.a,maskAt(pixel));
}
@fragment fn composeWaterRouted(@builtin(position) pixel:vec4f)->Routed{
 let c=waterColor(pixel);
 let r=waterRoute(pixel,c);
 return Routed(vec4f(c.rgb,c.a*r.keep),r.tint,r.add);
}
@fragment fn composeWaterRoutedReactive(@builtin(position) pixel:vec4f)->RoutedReactive{
 let c=waterColor(pixel);
 let r=waterRoute(pixel,c);
 return RoutedReactive(vec4f(c.rgb,c.a*r.keep),r.tint,r.add,vec4f(0.0,1.0,0.0,c.a));
}`;
