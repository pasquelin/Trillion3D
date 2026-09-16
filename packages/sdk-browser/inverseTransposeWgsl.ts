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
 *
 * Tout cela ne dépend que de la matrice : la normalisation, le déterminant et les trois produits
 * vectoriels de l'adjointe sont donc rassemblés dans `invTranspose3Prep`, calculée une fois, et
 * `invTranspose3Apply` ne garde par vecteur que le produit 3×3 et le facteur. Un ombrage qui
 * transforme les trois normales d'un triangle avec la même matrice ne refait plus le prologue trois
 * fois. Les opérandes et leur ordre par vecteur ne bougent pas — `facteur*(adjointe*v)`, comme
 * avant — donc le résultat reste celui d'avant, au bit près. `inverseTranspose3` reste l'écriture
 * publique pour un vecteur isolé.
 */
const NOYAU = (prep: string) => `
struct InvT3{adj:mat3x3f,facteur:f32,regulier:bool,}
fn invTranspose3Prep(m:mat3x3f)->InvT3{
${prep}
}
fn invTranspose3Apply(p:InvT3,v:vec3f)->vec3f{
 return select(v,p.facteur*(p.adj*v),p.regulier);
}
fn inverseTranspose3(m:mat3x3f,v:vec3f)->vec3f{return invTranspose3Apply(invTranspose3Prep(m),v);}`;

/** La préparation livrée : la 3×3 normalisée, puis le déterminant et l'adjointe de la normalisée. */
const PREP_LIVREE = ` let w=abs(m[0])+abs(m[1])+abs(m[2]);let t=w.x+w.y+w.z;
 let fini=(t>0.0)&&(bitcast<u32>(t)&0x7f800000u)!=0x7f800000u;
 let a=m[0]/t;let b=m[1]/t;let c=m[2]/t;
 let det=dot(a,cross(b,c));
 return InvT3(mat3x3f(cross(b,c),cross(c,a),cross(a,b)),1.0/(det*t),fini&&abs(det)>1e-20);`;

/**
 * La préparation d'AVANT le défaut 6 : seuil absolu `abs(det)<1e-20` sur la 3×3 BRUTE, et facteur
 * `1/det` au lieu de `1/(det·t)`. `regulier` est la négation exacte de l'ancien garde, celui qui
 * rendait le vecteur tel quel — donc la même décision, cas pour cas, NaN compris.
 */
const PREP_AVANT_DEFAUT_6 = ` let a=m[0];let b=m[1];let c=m[2];
 let det=dot(a,cross(b,c));
 return InvT3(mat3x3f(cross(b,c),cross(c,a),cross(a,b)),1.0/det,!(abs(det)<1e-20));`;

/** Le noyau livré : c'est celui-ci, et lui seul, que les nuanceurs de production insèrent. */
export const INVERSE_TRANSPOSE_WGSL = NOYAU(PREP_LIVREE);

/**
 * Le même noyau avec la préparation d'avant le défaut 6, POUR REJOUER LE DÉFAUT SEULEMENT : aucun
 * nuanceur de production ne l'insère. Il vit ici, contre le texte livré, plutôt que recopié dans un
 * banc : deux formes voisines dans un fichier bougent ensemble, tandis qu'une copie recollée
 * ailleurs cesse de correspondre au premier changement du noyau — sans que personne le voie. Le
 * bloc entier se substitue au bloc livré, structure comprise, et `bench/justesse/substitutionAvant.mjs`
 * établit la substitution au lieu de l'espérer. Une reproduction ne vaut que tant qu'elle reproduit :
 * GPU réellement exécuté, et mesurée contre ce que le moteur DESSINE (rasterisation réelle, état de
 * face compris), cette forme supprime 656 clusters dessinés sur 6 916 cas là où la forme livrée n'en
 * supprime aucun (`bench/justesse/inverse-transposee-petite-echelle.mjs`). Les « 560 avant, 54
 * après » d'un relevé antérieur lisaient l'orientation géométrique brute, qui ignore l'échange de
 * face sous réflexion : elle comptait 119 rejets légitimes comme des défauts et en manquait 215.
 */
export const INVERSE_TRANSPOSE_AVANT_WGSL = NOYAU(PREP_AVANT_DEFAUT_6);
