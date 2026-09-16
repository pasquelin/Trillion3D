/**
 * L'enregistrement froid d'une grappe et la résidence des pages, lus au mot dans le même tampon.
 *
 * Le cône, la boîte et la résidence vivaient dans une structure de quarante-huit octets que les cinq
 * passes de l'image lisaient en entier, la plupart du temps pour n'en tirer qu'un drapeau. Le tampon
 * est désormais un tableau de mots : la passe d'ouverture y prend le cône et la boîte, et les quatre
 * suivantes n'y lisent qu'un bit de résidence — un mot pour trente-deux grappes, donc une ligne de
 * cache pour cinq cents.
 *
 * Les rangs sont ceux de `gpuDagLayout.ts`, seule source de la disposition : l'oracle les relit par
 * le même décodeur, c'est ce qui le tient bit à bit sur le nuanceur.
 */
export const DAG_RECORD_WGSL = `const COLD:u32=12u;
fn coldF(i:u32,k:u32)->f32{return bitcast<f32>(cold[i*COLD+k]);}
fn coneOf(i:u32)->vec4f{return vec4f(coldF(i,0u),coldF(i,1u),coldF(i,2u),coldF(i,3u));}
fn boxMin(i:u32)->vec3f{return vec3f(coldF(i,4u),coldF(i,5u),coldF(i,6u));}
fn hasBox(i:u32)->f32{return coldF(i,7u);}
fn boxMax(i:u32)->vec3f{return vec3f(coldF(i,8u),coldF(i,9u),coldF(i,10u));}
/** Les bits de résidence prolongent les enregistrements froids : un mot pour trente-deux grappes. */
fn isResident(i:u32)->bool{return (cold[uni.clusterCount*COLD+(i>>5u)]&(1u<<(i&31u)))!=0u;}
`;
