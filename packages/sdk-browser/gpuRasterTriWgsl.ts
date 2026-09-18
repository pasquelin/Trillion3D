import { FINE_SPAN, LARGE_SPAN, TILE } from './gpuRasterContract.ts';

/**
 * Ce qu'un triangle décide avant qu'un pixel ne soit nommé, et la seule écriture de ce calcul : le
 * binning l'évalue une fois par triangle, les passes de raster le rejouent pour les seuls survivants,
 * depuis les mêmes entrées. L'ensemble qui atteint un pixel est donc celui qu'une évaluation par
 * pixel aurait atteint.
 *
 * Le partage avec le raster matériel se lit en premier, par le prédicat que les deux rasters
 * partagent (`computeTakes`) : un triangle que le matériel garde ne coûte ici que ses trois sommets.
 * Pour ceux que le calcul prend :
 *
 * - **La boîte est découpée au viewport au lieu d'être rejetée.** Un triangle qui déborde de l'écran
 *   garde la part de sa boîte qui tombe dans l'image, et c'est sur CETTE part que sa classe se lit.
 *   Un triangle entièrement hors champ n'a pas de boîte.
 * - **Le plan proche est découpé, pas rejeté** — sous `COMPUTE_ALL` seulement, un seuil laissant ces
 *   triangles au matériel. Un sommet plus près que le plan proche n'a pas de projection utilisable :
 *   on coupe en espace d'horloge sur le plan canonique `z <= w`, qui EST le plan proche puisque la
 *   projection pose `z_découpe = near` et `w_découpe = distance`. La coupe rend trois ou quatre
 *   sommets, donc un ou deux sous-triangles ; les coordonnées de texture suivent, sinon la découpe
 *   d'un matériau à masque ne serait pas la même des deux côtés du plan. L'identifiant écrit reste
 *   celui du triangle d'origine : la résolution matérielle reconstruit ses attributs depuis ses
 *   sommets non coupés.
 */
export const RASTER_TRI_WGSL = `
struct Clip{n:u32,p:array<vec4f,4>,u:array<vec2f,4>,}
fn clipNear(pa:vec4f,pb:vec4f,pc:vec4f,ua:vec2f,ub:vec2f,uc:vec2f)->Clip{
 var inP=array<vec4f,3>(pa,pb,pc);
 var inU=array<vec2f,3>(ua,ub,uc);
 var res:Clip;res.n=0u;
 for(var i=0u;i<3u;i=i+1u){
  let j=(i+1u)%3u;
  let cur=inP[i];let nxt=inP[j];
  // Distance signée au plan proche : positive devant, nulle sur le plan, négative derrière.
  let dc=cur.w-cur.z;let dn=nxt.w-nxt.z;
  let curIn=dc>=0.0;let nxtIn=dn>=0.0;
  if(curIn){res.p[res.n]=cur;res.u[res.n]=inU[i];res.n=res.n+1u;}
  if(curIn!=nxtIn){
   // Le point de coupe est calculé depuis le même sommet pour les deux triangles qui partagent
   // l'arête — celui qui est devant le plan —, sinon deux arrondis différents ouvraient la coupe.
   let fromCur=curIn;
   let p0=select(nxt,cur,fromCur);let p1=select(cur,nxt,fromCur);
   let u0=select(inU[j],inU[i],fromCur);let u1=select(inU[i],inU[j],fromCur);
   let d0=select(dn,dc,fromCur);let d1=select(dc,dn,fromCur);
   let t=d0/(d0-d1);
   // Le sommet coupé est reposé exactement sur le plan : son \`w\` vaut \`near\` au bit près, aucun
   // arrondi ne peut le rendre plus proche que le plan proche.
   var q=mix(p0,p1,t);q.w=q.z;
   res.p[res.n]=q;res.u[res.n]=mix(u0,u1,t);res.n=res.n+1u;
  }
 }
 return res;
}
struct Tri{ca:vec4f,cb:vec4f,cc:vec4f,cd:vec4f,
 a:vec2f,b:vec2f,c:vec2f,d:vec2f,ua:vec2f,ub:vec2f,uc:vec2f,ud:vec2f,lo:vec2f,hi:vec2f,
 ok:u32,row:u32,triangle:u32,quad:u32,area0:f32,area1:f32,}
fn setupTriangle(pageIndex:u32,triangle:u32,vp:mat4x4f,det:f32)->Tri{
 var t:Tri;t.ok=0u;t.row=pageIndex;t.triangle=triangle;t.quad=0u;
 let page=pages[pageIndex];
 if(uni.selectionEnabled!=0u&&selectionMask[uni.selectionOffset+page.selectionIndex]==0u){return t;}
 if(triangle*3u+2u>=page.indexCount){return t;}
 let ia=indices[page.pageOffset+triangle*3u];let ib=indices[page.pageOffset+triangle*3u+1u];let ic=indices[page.pageOffset+triangle*3u+2u];
 let ca=vertex(vp,page.vertexBase,ia);let cb=vertex(vp,page.vertexBase,ib);let cc=vertex(vp,page.vertexBase,ic);
 if(!computeTakes(ca,cb,cc)){return t;}
 // Seul un matériau à masque découpe dans le raster : lui seul paye la lecture de ses trois UV.
 var ua=vec2f(0.0);var ub=vec2f(0.0);var uc=vec2f(0.0);
 if((page.flags&128u)!=0u){ua=uv(page,ia);ub=uv(page,ib);uc=uv(page,ic);}
 let cl=clipNear(ca,cb,cc,ua,ub,uc);
 if(cl.n<3u){return t;}
 let a=screen(cl.p[0]);let b=screen(cl.p[1]);let c=screen(cl.p[2]);
 let area0=edge(a,b,c);
 var d=a;var ud=vec2f(0.0);var area1=0.0;
 if(cl.n==4u){d=screen(cl.p[3]);ud=cl.u[3];area1=edge(a,c,d);t.quad=1u;}
 // L'orientation du polygone coupé est celle du triangle d'origine : sur un triangle non coupé,
 // \`area0\` seule décide, au bit près comme avant.
 let orient=area0+area1;
 if(abs(orient)<1e-8){return t;}
 let front=select((orient>0.0),(orient<0.0),(det>=0.0));
 if((page.flags&2u)==0u){if((page.flags&256u)!=0u){if(front){return t;}}else if(!front){return t;}}
 var lo=min(a,min(b,c));var hi=max(a,max(b,c));
 if(cl.n==4u){lo=min(lo,d);hi=max(hi,d);}
 let box=boxOf(lo,hi);
 // Une boîte entièrement à gauche ou au-dessus de l'image se serre sur le bord : le serrage seul ne
 // la distingue pas d'une boîte qui touche ce bord, c'est la boîte NON serrée qui le dit.
 let last=uni.viewport-vec2f(1.0);
 if(hi.x<0.0||hi.y<0.0||lo.x>last.x||lo.y>last.y){return t;}
 t.ok=1u;t.a=a;t.b=b;t.c=c;t.d=d;t.ca=cl.p[0];t.cb=cl.p[1];t.cc=cl.p[2];t.cd=select(cl.p[0],cl.p[3],cl.n==4u);
 t.ua=cl.u[0];t.ub=cl.u[1];t.uc=cl.u[2];t.ud=ud;
 t.area0=area0;t.area1=area1;t.lo=box.q0;t.hi=box.q1;
 return t;
}
/** La classe de taille d'une boîte déjà découpée : le pavé qu'un groupe de fils couvre d'un coup. */
fn triClass(t:Tri)->u32{
 let span=max(t.hi.x-t.lo.x,t.hi.y-t.lo.y);
 if(span<=f32(${FINE_SPAN}u)){return 0u;}
 if(span<=f32(${TILE}u-1u)){return 1u;}
 if(span<=f32(${LARGE_SPAN}u)){return 2u;}
 return 3u;
}
/** Les pavés de huit pixels qu'une boîte couvre, en colonnes puis en lignes. */
fn tileCols(t:Tri)->u32{return u32(t.hi.x-t.lo.x)/${TILE}u+1u;}
fn tileRows(t:Tri)->u32{return u32(t.hi.y-t.lo.y)/${TILE}u+1u;}
`;
