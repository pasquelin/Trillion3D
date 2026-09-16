import { DEPTH_SHRINK, ERR_K, INPUT_K, SCREEN_SLACK_K, wgslFloat } from './gpuPartitionMargins.ts';
import {
  CORNER_VALUES,
  FLAG_CLIP,
  FLAG_HISTORY,
  FLAG_PREV_REST,
  PARTITION_WORKGROUP,
  ROW_DATA_U32,
  ROW_FLAGS,
  ROW_KEY,
  ROW_NEAREST,
  HISTO_BITS,
  STATE_HISTO,
  ST_HISTORY_OCCLUDERS,
  ST_IN_FRONT,
} from './gpuPartitionContract.ts';

const K = wgslFloat(ERR_K),
  IN = wgslFloat(INPUT_K),
  SLACK = wgslFloat(SCREEN_SLACK_K),
  SHRINK = wgslFloat(DEPTH_SHRINK);

/**
 * La projection d'une ligne résidente en rectangle d'écran et en borne de profondeur, faite par le
 * GPU en simple précision, **conservatrice par construction**.
 *
 * Le processeur projetait les huit coins monde en double précision. Ici la même arithmétique tourne
 * en `f32`, donc chaque produit scalaire porte une erreur d'arrondi. Elle n'est pas supposée : elle
 * est BORNÉE, terme par terme, par la somme des valeurs absolues des quatre produits qui composent
 * ce produit scalaire, plus la part des arrondis d'entrée (`gpuPartitionMargins.ts` porte les deux
 * démonstrations). Les coins entrent RELATIVEMENT à un point d'ancrage — la pose de la caméra —,
 * chacun porté par deux simples précisions, et les matrices reçues sont déjà composées avec cette
 * translation : sans quoi la borne, qui ne sait pas que les termes d'un modèle urbain se compensent,
 * rendrait des rectangles de centaines de texels et le test d'occultation ne trancherait plus rien.
 *
 * De cette borne découlent les trois règles :
 *  1. chaque coin élargit son point normalisé de son propre écart avant d'entrer dans le minimum et
 *     le maximum, puis le passage à l'écran retire ou ajoute la marge d'écran avant `floor` et
 *     `ceil` : le rectangle rendu CONTIENT donc celui que la double précision calculait ;
 *  2. une boîte qui touche ou traverse le plan proche — ou dont un dénominateur n'est pas sûrement
 *     positif — porte le drapeau de coupe, et une boîte qui le porte n'est jamais rejetée ;
 *  3. la profondeur la plus proche descend de l'écart de chaque coin, puis de deux ulps entiers
 *     avant le biais de couche : elle MINORE donc ce que le cluster écrira, comme
 *     `hizNearestBound` le garantissait en double précision.
 */
export const PARTITION_PROJECT_WGSL = `
/**
 * Un produit scalaire de quatre termes sur un point ancré, et de quoi borner son erreur :
 * la valeur, la somme des valeurs absolues des termes, et la part des arrondis d'entrée —
 * \`Σ|m_i| · 3u|d_i|\`, où \`d\` est l'écart du coin à l'ancre.
 */
fn dot4(a0:f32,a1:f32,a2:f32,a3:f32,d:vec3f,mag:vec3f)->vec3f{
 let p=vec3f(a0*d.x,a1*d.y,a2*d.z);
 return vec3f(
  p.x+p.y+p.z+a3,
  abs(p.x)+abs(p.y)+abs(p.z)+abs(a3),
  abs(a0)*mag.x+abs(a1)*mag.y+abs(a2)*mag.z);
}
/** L'écart majorant d'un produit scalaire : arrondis de calcul et arrondis d'entrée réunis. */
fn slackOf(term:vec3f)->f32{return ${K}*term.y+${IN}*term.z;}
/** Écart majorant d'un quotient dont le numérateur et le dénominateur portent chacun le leur. */
fn quotientSlack(value:f32,num:vec3f,den:vec3f)->f32{
 return (slackOf(num)+abs(value)*slackOf(den))/den.x+${K}*abs(value);
}
/** Le biais de couche coplanaire sur les bits d'une profondeur : miroir de \`biasedDepthBits\`. */
fn biasedDepth(value:f32,layer:u32)->f32{
 if(layer==0u){return value;}
 let units=min(layer,15u)*16u;
 let bits=bitcast<u32>(value);
 return bitcast<f32>(select(0u,bits-units,bits>=units));
}
/** Image ordonnable d'un flottant : la comparaison non signée des clés rend l'ordre des flottants. */
fn depthKey(value:f32)->u32{
 let bits=bitcast<u32>(value);
 return select(bits^0x80000000u,~bits,(bits&0x80000000u)!=0u);
}
@compute @workgroup_size(${PARTITION_WORKGROUP})
fn projectRows(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.rows){return;}
 let base=i*${ROW_DATA_U32}u;
 // L'historique d'occulteurs de l'image précédente : une ligne dessinée sans être occultée — moitié
 // occulteurs, ou moitié testée dont le verdict Hi-Z fut « visible » — occulte pour la suivante.
 // C'est le verdict de l'image d'avant, lu avant que le test Hi-Z de celle-ci ne remette à zéro.
 let held=rowData[base+${ROW_FLAGS}u];
 var drawn=1u;
 if((held&${FLAG_PREV_REST}u)!=0u){drawn=select(1u,0u,flags[i]!=0u);}
 if(drawn!=0u){atomicAdd(&state[${ST_HISTORY_OCCLUDERS}u],1u);}
 var lowX=1.0e30;var highX=-1.0e30;var lowY=1.0e30;var highY=-1.0e30;var lowZ=1.0e30;
 // La profondeur de VUE du coin le plus proche : la clé de partage, jamais celle du test Hi-Z.
 var lowView=1.0e30;
 var clips=false;
 let m=uni.viewProj;let v=uni.view;
 for(var k=0u;k<8u;k++){
  let at=i*${CORNER_VALUES}u+k*6u;
  // Le coin en deux mots, rapporté à l'ancre elle aussi en deux mots : la magnitude monde ne
  // survit à aucune de ces soustractions, et la borne d'entrée ne dépend plus que de l'écart.
  let high=vec3f(corners[at],corners[at+1u],corners[at+2u]);
  let low=vec3f(corners[at+3u],corners[at+4u],corners[at+5u]);
  let d=(high-uni.anchorHigh)+(low-uni.anchorLow);
  let mag=abs(d);
  let vz=dot4(v[0][2],v[1][2],v[2][2],v[3][2],d,mag);
  let vd=dot4(v[0][3],v[1][3],v[2][3],v[3][3],d,mag);
  // Un dénominateur de vue qui n'est pas sûrement positif rend la profondeur de vue indécidable :
  // la boîte part en coupe, où rien ne la rejette.
  if(!(vd.x>slackOf(vd))){clips=true;break;}
  let depth=-(vz.x/vd.x);
  if(depth-quotientSlack(depth,vz,vd)<=uni.near){clips=true;break;}
  lowView=min(lowView,depth);
  let cw=dot4(m[0][3],m[1][3],m[2][3],m[3][3],d,mag);
  if(!(cw.x>slackOf(cw))||!(abs(cw.x)<3.0e38)){clips=true;break;}
  let cx=dot4(m[0][0],m[1][0],m[2][0],m[3][0],d,mag);
  let cy=dot4(m[0][1],m[1][1],m[2][1],m[3][1],d,mag);
  let cz=dot4(m[0][2],m[1][2],m[2][2],m[3][2],d,mag);
  let nx=cx.x/cw.x;let ny=cy.x/cw.x;let nz=cz.x/cw.x;
  lowX=min(lowX,nx-quotientSlack(nx,cx,cw));highX=max(highX,nx+quotientSlack(nx,cx,cw));
  lowY=min(lowY,ny-quotientSlack(ny,cy,cw));highY=max(highY,ny+quotientSlack(ny,cy,cw));
  lowZ=min(lowZ,nz-quotientSlack(nz,cz,cw));
 }
 var nearest=0.0;var rect=vec4i(0,0,0,0);var bits=${FLAG_CLIP}u;
 if(!clips){
  let wF=f32(uni.width);let hF=f32(uni.height);
  let slack=${SLACK}*max(wF,hF)+1.0e-4;
  rect=vec4i(
   i32(floor((lowX*0.5+0.5)*wF-slack)),
   i32(floor((1.0-(highY*0.5+0.5))*hF-slack)),
   i32(ceil((highX*0.5+0.5)*wF+slack)),
   i32(ceil((1.0-(lowY*0.5+0.5))*hF+slack)));
  nearest=lowZ*0.5+0.5;
  if(nearest>0.0){nearest=biasedDepth(nearest*${SHRINK},items[i].layer);}
  bits=0u;
  atomicAdd(&state[${ST_IN_FRONT}u],1u);
  atomicAdd(&state[${STATE_HISTO}u+(depthKey(lowView)>>${32 - HISTO_BITS}u)],1u);
 }
 rowData[base]=bitcast<u32>(rect.x);
 rowData[base+1u]=bitcast<u32>(rect.y);
 rowData[base+2u]=bitcast<u32>(rect.z);
 rowData[base+3u]=bitcast<u32>(rect.w);
 rowData[base+${ROW_NEAREST}u]=bitcast<u32>(nearest);
 rowData[base+${ROW_FLAGS}u]=bits|select(0u,${FLAG_HISTORY}u,drawn!=0u);
 rowData[base+${ROW_KEY}u]=depthKey(lowView);
}
`;
