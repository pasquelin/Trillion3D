import { BOUNCE_SETTINGS, PROXY_CHILDREN, PROXY_TRIANGLE_FLOATS } from '../sdk-core/index.ts';
import { BOUNCE_NODE_WGSL } from './bounceNodeWgsl.ts';

/**
 * La traversée du proxy résident : un BVH à quatre enfants, ordonné par distance, avec sortie
 * anticipée.
 *
 * Un nœud teste ses quatre boîtes d'un coup, descend aussitôt sur la plus proche et empile les
 * autres. Un nœud dépilé est retesté contre la distance du plus proche triangle déjà touché : dès
 * qu'un rayon a touché quelque chose, tout ce qui est derrière tombe sans être ouvert. C'est ce qui
 * remplace la descente d'un cran par nœud de l'arbre binaire, où la borne de traversée s'épuisait
 * avant la feuille sur le proxy d'une ville.
 *
 * Trois bornes connues avant l'image (X2) : les nœuds visités, les triangles d'une feuille, et la
 * profondeur de la pile — un nœud large en empile trois au plus, et l'arbre est équilibré par
 * construction, si bien que la pile ne déborde pas ; si elle débordait, l'enfant en trop serait
 * abandonné, ce qui assombrit et ne fuit jamais.
 */
export const BOUNCE_TRACE_WGSL = `
const TRAVERSAL_STEPS:u32=${BOUNCE_SETTINGS.traversalSteps}u;
const LEAF_TRIANGLES:u32=${BOUNCE_SETTINGS.proxyLeafTriangles}u;
const TRIANGLE_FLOATS:u32=${PROXY_TRIANGLE_FLOATS}u;
const CHILDREN:u32=${PROXY_CHILDREN}u;
const STACK_DEPTH:u32=${BOUNCE_SETTINGS.traversalStack}u;
struct ProxyHit{distance:f32,triangle:u32,found:bool,}
${BOUNCE_NODE_WGSL}
/** Möller–Trumbore, double face : un mur n'a pas d'endroit ni d'envers pour la lumière. */
fn triangleHit(index:u32,origin:vec3f,direction:vec3f,limit:f32)->f32{
 let a=proxyVertex(index,0u);
 let edge0=proxyVertex(index,1u)-a;
 let edge1=proxyVertex(index,2u)-a;
 let perpendicular=cross(direction,edge1);
 let determinant=dot(edge0,perpendicular);
 if(abs(determinant)<1e-12){return limit;}
 let inverse=1.0/determinant;
 let offset=origin-a;
 let u=dot(offset,perpendicular)*inverse;
 if(u<0.0||u>1.0){return limit;}
 let across=cross(offset,edge0);
 let v=dot(direction,across)*inverse;
 if(v<0.0||u+v>1.0){return limit;}
 let distance=dot(edge1,across)*inverse;
 if(distance<=1e-4||distance>=limit){return limit;}
 return distance;
}
/** Le plus proche triangle touché, ou rien. La direction est supposée normalisée. */
fn traceProxy(origin:vec3f,direction:vec3f,limit:f32)->ProxyHit{
 var best=ProxyHit(limit,0u,false);
 if(proxyNodeCount()==0u){return best;}
 let inverse=rayInverse(direction);
 var stack:array<u32,${BOUNCE_SETTINGS.traversalStack}>;
 var depth=0u;
 var node=0u;
 for(var step=0u;step<TRAVERSAL_STEPS;step++){
  let frame=nodeBox(node);
  if(boxEntry(frame,origin,inverse,best.distance)>best.distance){
   if(depth==0u){break;}
   depth--;node=stack[depth];continue;
  }
  var nearest=0u;
  var nearestSpan=best.distance+1.0;
  for(var slot=0u;slot<CHILDREN;slot++){
   let child=proxyChild(node,slot,frame);
   if(!child.present){continue;}
   let span=boxEntry(child.box,origin,inverse,best.distance);
   if(span>best.distance){continue;}
   if(child.count>0u){
    for(var k=0u;k<LEAF_TRIANGLES;k++){
     if(k>=child.count){break;}
     let index=child.offset+k;
     let distance=triangleHit(index,origin,direction,best.distance);
     if(distance<best.distance){best=ProxyHit(distance,index,true);}
    }
    continue;
   }
   if(span<nearestSpan){
    if(nearestSpan<=best.distance&&depth<STACK_DEPTH){stack[depth]=nearest;depth++;}
    nearest=child.offset;
    nearestSpan=span;
   }else if(depth<STACK_DEPTH){stack[depth]=child.offset;depth++;}
  }
  if(nearestSpan<=best.distance){node=nearest;continue;}
  if(depth==0u){break;}
  depth--;node=stack[depth];
 }
 return best;
}
/** Vrai dès qu'un triangle coupe le segment : une ombre n'a pas besoin du plus proche. */
fn proxyBlocked(origin:vec3f,direction:vec3f,limit:f32)->bool{
 if(proxyNodeCount()==0u){return false;}
 let inverse=rayInverse(direction);
 var stack:array<u32,${BOUNCE_SETTINGS.traversalStack}>;
 var depth=0u;
 var node=0u;
 for(var step=0u;step<TRAVERSAL_STEPS;step++){
  let frame=nodeBox(node);
  var descend=false;
  var next=0u;
  if(boxEntry(frame,origin,inverse,limit)<=limit){
   for(var slot=0u;slot<CHILDREN;slot++){
    let child=proxyChild(node,slot,frame);
    if(!child.present){continue;}
    if(boxEntry(child.box,origin,inverse,limit)>limit){continue;}
    if(child.count>0u){
     for(var k=0u;k<LEAF_TRIANGLES;k++){
      if(k>=child.count){break;}
      if(triangleHit(child.offset+k,origin,direction,limit)<limit){return true;}
     }
     continue;
    }
    if(!descend){descend=true;next=child.offset;}
    else if(depth<STACK_DEPTH){stack[depth]=child.offset;depth++;}
   }
  }
  if(descend){node=next;continue;}
  if(depth==0u){break;}
  depth--;node=stack[depth];
 }
 return false;
}`;
