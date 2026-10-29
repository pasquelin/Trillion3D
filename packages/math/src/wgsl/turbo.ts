import { wgslFn } from './decl.ts'

/**
 * The Turbo colour map (a polynomial fit of Google's rainbow, blue at 0, green near the middle, red at 1): a unit value `t`, held
 * to [0, 1], to a linear colour. The views that show a count or a distance read it from the green half (`greenToRedTurbo`).
 */
export const colorMapTurbo = wgslFn(
  'colorMapTurbo',
  [],
  `fn colorMapTurbo(x:f32)->vec3f{
 let t=clamp(x,0.0,1.0);
 let c0=vec3f(0.1140890109226559,0.06288340699912215,0.2248337216805064);
 let c1=vec3f(6.716419496985708,3.182286745507602,7.571581586103393);
 let c2=vec3f(-66.09402360453038,-4.9279827041226,-10.09439367561635);
 let c3=vec3f(228.7660791526501,25.04986699771073,-91.54105330182436);
 let c4=vec3f(-334.8351565777451,-69.31749712757485,288.5858850615712);
 let c5=vec3f(218.7637218434795,67.52150567819112,-305.2045772184957);
 let c6=vec3f(-52.88903478218835,-21.54527364654712,110.5174647748972);
 return c0+t*(c1+t*(c2+t*(c3+t*(c4+t*(c5+t*c6)))));
}`,
)

/** The green-to-red half of the map: 0 green, 1 and more red. */
export const greenToRedTurbo = wgslFn(
  'greenToRedTurbo',
  [colorMapTurbo],
  'fn greenToRedTurbo(s:f32)->vec3f{return colorMapTurbo(mix(0.5,1.0,saturate(s)));}',
)
