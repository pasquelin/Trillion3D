/** An integer mixed then folded into [0,1): the seed of a rotation or of a stratum offset,
 *  never a random number — the same input always gives the same output. */
export const HASH_UNIT_WGSL = `
fn hashUnit(seed:u32)->f32{
 var x=seed*747796405u+2891336453u;
 x=((x>>((x>>28u)+4u))^x)*277803737u;
 x=(x>>22u)^x;
 return f32(x)*2.3283064e-10;
}`;
