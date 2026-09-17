/**
 * Compaction de la liste des pages dessinables, faite par la carte graphique.
 *
 * `dagMask` laisse un drapeau par page derrière `flags[nodeCount + i]`. Le processeur le relisait en
 * entier — cent mille mots par relevé, dont quinze mille utiles — pour en tirer la liste croissante
 * des pages à dessiner. Ces deux noyaux la rendent déjà compactée : le relevé ne rapporte plus qu'un
 * compte et ce compte d'identifiants.
 *
 * L'ordre est celui de l'ancien parcours, page par page croissante, et non celui d'un compteur
 * atomique : chaque bloc de soixante-quatre pages connaît le nombre de ses dessinées, un balayage en
 * deux temps donne à chaque bloc son décalage, puis chaque page retrouve son rang dans son propre
 * bloc. Somme en u32, associative ; le décalage d'un bloc ne dépend que des blocs qui le précèdent.
 * La liste rendue est donc terme pour terme celle que le processeur construisait.
 *
 * Le compte d'un bloc n'est plus relu après coup : `dagMask`, seul à poser un drapeau de dessin,
 * l'accumule dans le bloc de sa propre page. Un lancement de moins, et deux millions de drapeaux
 * relus en moins — la somme reste celle des mêmes termes, l'addition d'entiers étant commutative.
 *
 * Aucun tampon neuf : le plafond d'une étape est de huit tampons de stockage, déjà atteint. Les
 * comptes et décalages de bloc vivent derrière les seuils de `work`, la liste derrière les pages
 * voulues de `out` — un compte, trois mots de calage, puis les rangs — si bien que le relevé reste
 * une seule copie contiguë.
 */
export const DAG_COMPACT_WGSL = `const BLOCK:u32=64u;
fn drawFlag(i:u32)->u32{return flags[uni.nodeCount+i];}
fn blockCount()->u32{return (uni.clusterCount+BLOCK-1u)/BLOCK;}
/** Premier mot de la zone des blocs dans \`work\`, après les seuils et les drapeaux de couverture. */
fn blockBase()->u32{return uni.worldCount*2u;}
var<workgroup> laneTotals:array<u32,64>;
@compute @workgroup_size(64)
fn dagDrawPrefix(@builtin(local_invocation_id) lid:vec3u){
 let lane=lid.x;let count=blockCount();let base=blockBase();
 let chunk=(count+63u)/64u;
 let begin=min(lane*chunk,count);let end=min(begin+chunk,count);
 var total=0u;
 for(var b=begin;b<end;b++){total=total+atomicLoad(&work[base+b]);}
 laneTotals[lane]=total;
 workgroupBarrier();
 var cursor=0u;
 for(var l=0u;l<lane;l++){cursor=cursor+laneTotals[l];}
 for(var b=begin;b<end;b++){
  let n=atomicLoad(&work[base+b]);
  atomicStore(&work[base+count+b],cursor);
  cursor=cursor+n;
 }
 // Le dernier fil a resommé tous les totaux, que sa propre tranche soit vide ou non : c'est le total.
 if(lane==63u){out.pages[uni.listCap]=cursor;if(cursor>uni.listCap){atomicOr(&out.overflow,1u);}}
}
@compute @workgroup_size(64)
fn dagDrawScatter(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=liveCount()){return;}
 // Seules les grappes vivantes portent un drapeau de dessin non nul ; celles du bloc qui n'y sont
 // pas valent zéro et n'ajoutent rien au rang, exactement comme au parcours complet d'hier.
 let i=liveAt(s);if(drawFlag(i)==0u){return;}
 let b=i/BLOCK;let begin=b*BLOCK;
 var rank=0u;
 for(var j=begin;j<i;j++){rank=rank+drawFlag(j);}
 let off=atomicLoad(&work[blockBase()+blockCount()+b]);
 let at=off+rank;if(at>=uni.listCap){atomicOr(&out.overflow,1u);return;}
 out.pages[uni.listCap+4u+at]=i;
}
`;
