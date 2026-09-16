/**
 * Inverse-transposée 3×3 en WGSL, écrite une seule fois pour tout le moteur : le noyau de sélection
 * du DAG (`gpuDagShader.ts`, axe de cône) et la transformation des normales d'éclairage
 * (`standardLighting.ts`, `xformNormal`) partagent ce texte. Les déclarations de module WGSL se
 * lisent dans n'importe quel ordre : ce morceau s'ajoute au texte de chaque shader.
 *
 * La dégénérescence se juge sur le déterminant NORMALISÉ, jamais sur le déterminant brut. Un seuil
 * absolu juge l'échelle, pas la dégénérescence : une rotation d'échelle uniforme s a pour
 * déterminant ±s³, donc s ≲ 2,15e-7 passait sous 1e-20 et la fonction rendait le vecteur LOCAL, non
 * tourné. La 3×3 est donc divisée par la somme de ses valeurs absolues — exactement la
 * normalisation de `isConformal` — avant le déterminant. Sous 1e-12, s³ lui-même devient dénormal
 * en f32 : seule cette normalisation franchit ce plancher. Somme nulle, infinie ou NaN (lue au
 * bit) : le vecteur est rendu tel quel.
 */
export const INVERSE_TRANSPOSE_WGSL = `
fn inverseTranspose3(m:mat3x3f,v:vec3f)->vec3f{
 let w=abs(m[0])+abs(m[1])+abs(m[2]);let t=w.x+w.y+w.z;
 if(!(t>0.0)||(bitcast<u32>(t)&0x7f800000u)==0x7f800000u){return v;}
 let a=m[0]/t;let b=m[1]/t;let c=m[2]/t;
 let det=dot(a,cross(b,c));
 if(!(abs(det)>1e-20)){return v;}
 return (1.0/(det*t))*(mat3x3f(cross(b,c),cross(c,a),cross(a,b))*v);
}`;
