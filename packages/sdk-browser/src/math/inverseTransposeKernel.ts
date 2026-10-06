/** The 3×3 inverse-transpose kernel around its prepare (`inverseTransposeWgsl.ts`): `prep` computes
 *  the adjoint, the factor and whether the matrix is regular, `fallback` is what a singular one
 *  returns. The shipped kernel and the replay of defect 6 (`inverseTransposeBefore.fixture.ts`)
 *  differ by these two only. */
export const inverseTransposeKernel = (prep: string, fallback: string) => `
struct InvT3{adj:mat3x3f,scale:f32,regular:bool,}
fn invTranspose3Prep(m:mat3x3f)->InvT3{
${prep}
}
fn invTranspose3Apply(p:InvT3,v:vec3f)->vec3f{
 let carried=p.adj*v;
 return select(${fallback},p.scale*carried,p.regular);
}
fn inverseTranspose3(m:mat3x3f,v:vec3f)->vec3f{return invTranspose3Apply(invTranspose3Prep(m),v);}
fn uniteOuZero(v:vec3f)->vec3f{return select(vec3f(0.0),normalize(v),dot(v,v)>0.0);}`
