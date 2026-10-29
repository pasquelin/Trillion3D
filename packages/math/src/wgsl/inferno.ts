import { wgslFn } from './decl.ts'

/**
 * The Inferno colour map (a polynomial fit of the perceptual map that runs from black through purple and orange to pale yellow): a unit value `t`, held to [0, 1], to a linear colour. The views that
 * show how much of something a texel took read it, black for none.
 */
export const colorMapInferno = wgslFn(
  'colorMapInferno',
  [],
  `fn colorMapInferno(x:f32)->vec3f{
 let t=clamp(x,0.0,1.0);
 let c0=vec3f(0.0002189403691192265,0.001651004631001012,-0.01948089843709184);
 let c1=vec3f(0.1065134194856116,0.5639564367884091,3.932712388889277);
 let c2=vec3f(11.60249308247187,-3.972853965665698,-15.9423941062914);
 let c3=vec3f(-41.70399613139459,17.43639888205313,44.35414519872813);
 let c4=vec3f(77.162935699427,-33.40235894210092,-81.80730925738993);
 let c5=vec3f(-71.31942824499214,32.62606426397723,73.20951985803202);
 let c6=vec3f(25.13112622477341,-12.24266895238567,-23.07032500287172);
 return c0+t*(c1+t*(c2+t*(c3+t*(c4+t*(c5+t*c6)))));
}`,
)
