import { WRAP_MAP } from './visibilityWrapModes.ts';
import { FEEDBACK_EVERY, FEEDBACK_STRIDE } from './webgpuTileFeedback.ts';

const STRIDE_MASK = FEEDBACK_STRIDE - 1;

/**
 * Le retour d'image des textures virtuelles : le rang de la tuile qu'un pixel DEMANDE, posé dans la
 * cible de retour de l'image et réduit en compteurs par une passe de calcul (`webgpuTileReduce.ts`)
 * pour un pixel sur seize. Le niveau et l'adresse sont ceux de la lecture (`slotLod`, `${k}Entry`) :
 * ce qu'un pixel demande est ce qu'il lit. Exige `TILE_POOL_WGSL` et les lectures de l'atlas
 * (`COLOR_SAMPLE_WGSL`, `DATA_SAMPLE_WGSL`) avant ce bloc.
 */
const request = (
  k: string,
) => `fn ${k}RequestIndex(slot:u32,uv:vec2f,wrap:u32,ddx:vec2f,ddy:vec2f,next:bool)->u32{
 let s=${k}Slot(slot);
 if(s.tail==0u){return 0u;}
 let lod=slotLod(s,ddx,ddy);
 let level=u32(floor(lod))+select(0u,1u,next&&lod-floor(lod)>0.0);
 if(level>=s.tail){return 0u;}
 return ${k}Entry(s,slotWrapped(s,uv,wrap),level)-${k}Pages[2]+${k}Pages[0]+1u;
}`;

const m = WRAP_MAP;
/**
 * Le rang de tuile qu'un pixel demande, plus un, ou zéro : `colorRequestIndex(slot, uv, wrap, ddx,
 * ddy, next)` et `dataRequestIndex(...)`, `next` choisissant le second niveau du mélange.
 *
 * Puis la règle commune aux deux passes qui écrivent la cible de retour — résolution opaque et
 * mélange — : un pixel ne parle que si c'est sa phase (`feedbackPhase`, tous pendant une
 * convergence), et il demande UNE carte, choisie par sa POSITION (`requestPick`) : une tuile couvre
 * des dizaines de pixels, donc chaque carte et chacun des deux niveaux du mélange est nommé par une
 * part d'entre eux, et deux images complètes d'une même pose nomment le même ensemble. Le rang de
 * choix est celui de `WRAP_MAP` ; une carte absente laisse parler la couleur de base
 * (`mapRequest`). Les hôtes construisent leurs slots depuis la fiche de page ou l'item transparent.
 */
export const TILE_REQUEST_WGSL = `${request('color')}
${request('data')}
fn feedbackPhase(p:vec2f,word:u32)->bool{
 if((word&${FEEDBACK_EVERY}u)!=0u){return true;}
 return ((u32(p.x)&${STRIDE_MASK}u)|((u32(p.y)&${STRIDE_MASK}u)<<2u))==(word&${FEEDBACK_EVERY - 1}u);
}
struct RequestPick{sel:u32,next:bool,}
fn requestPick(pos:vec2f,choices:u32)->RequestPick{
 let px=u32(pos.x)+u32(pos.y);
 return RequestPick(px%choices,((px/choices)&1u)==1u);
}
/** \`color\` : base, émissif ; \`data\` : rugosité, métal, normales, occlusion. */
fn mapRequest(sel:u32,color:vec2u,data:vec4u,uv:vec2f,wrap:u32,ddx:vec2f,ddy:vec2f,next:bool)->u32{
 var slot=color.x;var isColor=true;var map=${m.base}u;
 if(sel==${m.rough}u){slot=data.x;isColor=false;map=${m.rough}u;}
 else if(sel==${m.metal}u){slot=data.y;isColor=false;map=${m.metal}u;}
 else if(sel==${m.normal}u){slot=data.z;isColor=false;map=${m.normal}u;}
 else if(sel==${m.ao}u){slot=data.w;isColor=false;map=${m.ao}u;}
 else if(sel==${m.emissive}u){slot=color.y;map=${m.emissive}u;}
 if(slot==0u){slot=color.x;isColor=true;map=${m.base}u;}
 if(slot==0u){return 0u;}
 if(isColor){return colorRequestIndex(slot,uv,wrapOf(wrap,map),ddx,ddy,next);}
 return dataRequestIndex(slot,uv,wrapOf(wrap,map),ddx,ddy,next);
}`;
