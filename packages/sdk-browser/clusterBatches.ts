import * as THREE from 'three';

/**
 * Lots de clusters à tampon d'index persistant.
 *
 * Une primitive source (jeu d'attributs partagé) possède un seul tampon d'index résident. Chaque page
 * y reçoit une plage fixe quand elle devient résidente : on n'écrit que cette plage, jamais tout le
 * tampon, et l'éviction la rend à l'allocateur. La coupe visible d'une image n'est alors qu'une liste
 * de sous-dessins (starts/counts) soumise en un appel par instance via `WEBGL_multi_draw` ; Three.js
 * retombe seul sur une boucle de drawElements quand l'extension manque.
 *
 * Le coût d'une image ne dépend donc plus du nombre total de pages ni du changement de coupe, mais
 * seulement du nombre de pages affichées.
 *
 * Limite assumée du prototype : la capacité d'une primitive est la somme des tailles de toutes ses
 * pages (exactes et grossières). Elle est donc résidente même quand la coupe n'en montre qu'une
 * partie ; borner cette capacité (et évincer des plages sous pression) reste à faire.
 *
 * Limite connue sur l'image : `isBatchedMesh` fait définir USE_BATCHING par Three.js, donc compiler une
 * variante de programme où les sommets passent par une multiplication supplémentaire. Cette matrice vaut
 * l'identité et le calcul est exact, mais le pilote n'arrondit pas tout à fait pareil : sur
 * emerald-square, 0,04 % à 0,39 % des pixels changent, sur des bords de silhouette. Annuler la définition
 * (`#undef USE_BATCHING` posé par `onBeforeCompile`) ramène l'écart maximal de 197 à 6 niveaux et rend
 * low-poly-city identique au bit près, mais coûte plus de la moitié des images présentées : à reprendre.
 */

/** Forme structurelle d'un enregistrement de page. Volontairement structurelle : aucun couplage à pageSelection.ts. */
export type BatchPage={
 id:number;
 url:string;
 array?:Uint32Array;
 triangles:number;
 min:number[];
 max:number[];
 attributes:THREE.BufferGeometry['attributes'];
 material:THREE.Material|THREE.Material[];
 transparent?:boolean;
 sourceOrder?:number;
 matrix:THREE.Matrix4;
 renderOrder:number;
};

export type FreeRange={offset:number;length:number};

/** Allocateur de plages : première place libre, fusion des voisins à la libération, croissance en dernier recours. */
export class IndexRangeAllocator{
 private ranges:FreeRange[]=[];
 private total:number;
 private busy=0;
 constructor(capacity:number){
  this.total=Math.max(0,Math.floor(capacity));
  if(this.total>0)this.ranges.push({offset:0,length:this.total});
 }
 get capacity(){return this.total;}
 get used(){return this.busy;}
 get freeRanges():readonly FreeRange[]{return this.ranges;}
 /** Renvoie l'offset de la plage réservée, ou -1 si aucune place contiguë ne convient. */
 allocate(length:number){
  if(!(length>0))return -1;
  for(let i=0;i<this.ranges.length;i++){
   const range=this.ranges[i];
   if(range.length<length)continue;
   const offset=range.offset;
   if(range.length===length)this.ranges.splice(i,1);
   else{range.offset+=length;range.length-=length;}
   this.busy+=length;
   return offset;
  }
  return -1;
 }
 release(offset:number,length:number){
  if(!(length>0))return;
  this.busy-=length;
  let i=0;while(i<this.ranges.length&&this.ranges[i].offset<offset)i++;
  const previous=i>0?this.ranges[i-1]:undefined,next=this.ranges[i];
  const joinsPrevious=!!previous&&previous.offset+previous.length===offset;
  const joinsNext=!!next&&offset+length===next.offset;
  if(joinsPrevious&&joinsNext){previous!.length+=length+next!.length;this.ranges.splice(i,1);return;}
  if(joinsPrevious){previous!.length+=length;return;}
  if(joinsNext){next!.offset=offset;next!.length+=length;return;}
  this.ranges.splice(i,0,{offset,length});
 }
 /** Étend la capacité ; la place ajoutée fusionne avec la fin libre. */
 grow(extra:number){
  const added=Math.max(0,Math.floor(extra));
  if(!added)return this.total;
  const end=this.total;
  this.total+=added;this.busy+=added;
  this.release(end,added);
  return this.total;
 }
}

/** Liste de sous-dessins réutilisée d'une image à l'autre. `starts` en octets (ce qu'attend Three.js), `counts` en indices. */
export class DrawRanges{
 starts=new Int32Array(8);
 counts=new Int32Array(8);
 count=0;
 reset(){this.count=0;}
 /** Ajoute une plage ; fusionne avec la précédente si elle la prolonge. Renvoie true si un sous-dessin a été créé. */
 push(offset:number,length:number){
  const bytes=offset*Uint32Array.BYTES_PER_ELEMENT;
  if(this.count>0){
   const last=this.count-1;
   if(this.starts[last]+this.counts[last]*Uint32Array.BYTES_PER_ELEMENT===bytes){this.counts[last]+=length;return false;}
  }
  if(this.count===this.starts.length){
   const size=this.starts.length*2;
   const starts=new Int32Array(size);starts.set(this.starts);this.starts=starts;
   const counts=new Int32Array(size);counts.set(this.counts);this.counts=counts;
  }
  this.starts[this.count]=bytes;this.counts[this.count]=length;this.count++;
  return true;
 }
}

/** Matrice identité unique partagée : le lot ne transporte aucune transformation, la matrice monde reste celle de l'objet. */
function identityMatrixTexture(){
 const data=new Float32Array(4*4*4);
 data.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
 const texture=new THREE.DataTexture(data,4,4,THREE.RGBAFormat,THREE.FloatType);
 texture.needsUpdate=true;
 return texture;
}
/** Table d'indirection nulle : tous les sous-dessins pointent la seule matrice du lot. */
function zeroIndirectTexture(maxDraws:number){
 let size=4;while(size*size<Math.max(1,maxDraws))size*=2;
 const texture=new THREE.DataTexture(new Uint32Array(size*size),size,size,THREE.RedIntegerFormat,THREE.UnsignedIntType);
 texture.internalFormat='R32UI';
 texture.needsUpdate=true;
 return texture;
}

/**
 * Objet de dessin d'un groupe. `isBatchedMesh` fait passer Three.js par `renderMultiDraw` (ou sa boucle
 * de repli quand `WEBGL_multi_draw` manque) ; la matrice de lot étant l'identité, la transformation des
 * sommets reste exactement `modelViewMatrix * position`, comme avec un THREE.Mesh ordinaire.
 */
class ClusterDrawMesh extends THREE.Mesh{
 isBatchedMesh=true;
 _multiDrawStarts:Int32Array;
 _multiDrawCounts:Int32Array;
 _multiDrawCount=0;
 _multiDrawInstances:Int32Array|null=null;
 _matricesTexture:THREE.DataTexture;
 _indirectTexture:THREE.DataTexture;
 _colorsTexture:THREE.DataTexture|null=null;
 /** Three.js lit `colorTexture` sans souligné : laissé indéfini, il recompilerait la clé de programme à chaque dessin. */
 colorTexture:THREE.DataTexture|null=null;
 constructor(geometry:THREE.BufferGeometry,material:THREE.Material|THREE.Material[],ranges:DrawRanges,matrices:THREE.DataTexture,indirect:THREE.DataTexture){
  super(geometry,material);
  this._multiDrawStarts=ranges.starts;this._multiDrawCounts=ranges.counts;
  this._matricesTexture=matrices;this._indirectTexture=indirect;
  this.matrixAutoUpdate=false;this.frustumCulled=false;
 }
}

type PageSlot={offset:number;length:number};

/**
 * Au-delà de ce nombre de plages en attente, un seul envoi du tampon entier coûte moins cher que la
 * nuée de `bufferSubData` que Three.js émettrait. Le préchargement, qui rend des milliers de pages
 * résidentes avant le premier dessin d'une primitive, tombe dans ce cas.
 */
const PENDING_RANGE_LIMIT=64;

/** Tampon d'index résident d'une primitive : géométrie unique partagée par toutes ses instances. */
class PrimitiveIndex{
 geometry=new THREE.BufferGeometry();
 array:Uint32Array;
 attribute:THREE.BufferAttribute;
 allocator:IndexRangeAllocator;
 /** Une plage par URL distincte de la primitive ; `undefined` tant que la page n'est pas résidente. */
 slots:Array<PageSlot|undefined>;
 /** id de page -> rang d'URL distincte : accès O(1) sans table de hachage par image. */
 urlIndexByPage:Int32Array;
 /** Marquage d'image par URL distincte, pour dédupliquer la liste des pages sans Set. */
 stamps:Int32Array;
 /** Plages écrites et pas encore envoyées au GPU ; `overflow` bascule sur un envoi complet. */
 pendingOffsets:number[]=[];
 pendingLengths:number[]=[];
 pendingCount=0;
 overflow=false;
 constructor(attributes:THREE.BufferGeometry['attributes'],urlIndexByPage:Int32Array,lengths:Int32Array,bounds:THREE.Box3){
  this.urlIndexByPage=urlIndexByPage;
  let capacity=0;for(let i=0;i<lengths.length;i++)capacity+=lengths[i];
  this.array=new Uint32Array(capacity);
  this.attribute=new THREE.BufferAttribute(this.array,1);
  this.allocator=new IndexRangeAllocator(capacity);
  this.slots=new Array(lengths.length);
  this.stamps=new Int32Array(lengths.length);
  this.geometry.attributes={...attributes};
  this.geometry.setIndex(this.attribute);
  this.geometry.boundingBox=bounds.clone();
  this.geometry.boundingSphere=new THREE.Sphere();
  bounds.getBoundingSphere(this.geometry.boundingSphere);
 }
 /** Recrée le tampon plus grand : filet de sécurité si une page dépasse la taille annoncée par le manifeste. */
 private growTo(capacity:number){
  const array=new Uint32Array(capacity);array.set(this.array);
  this.allocator.grow(capacity-this.array.length);
  this.array=array;
  this.attribute=new THREE.BufferAttribute(array,1);
  this.geometry.setIndex(this.attribute);
 }
 reserve(urlIndex:number,array:Uint32Array){
  const known=this.slots[urlIndex];
  if(known)return known;
  let offset=this.allocator.allocate(array.length);
  if(offset<0){this.growTo(this.array.length+array.length);offset=this.allocator.allocate(array.length);}
  this.array.set(array,offset);
  // L'envoi est différé au moment du dessin : c'est là seulement qu'on sait si Three.js consommera
  // les plages, donc qu'on peut décider entre plages fines et envoi complet sans rien perdre.
  if(this.pendingCount<PENDING_RANGE_LIMIT){this.pendingOffsets[this.pendingCount]=offset;this.pendingLengths[this.pendingCount]=array.length;this.pendingCount++;}
  else this.overflow=true;
  const slot:PageSlot={offset,length:array.length};
  this.slots[urlIndex]=slot;
  return slot;
 }
 /** Appelé juste avant le rendu de la primitive : Three.js consommera l'envoi dans la foulée. */
 flush(){
  if(!this.pendingCount&&!this.overflow)return;
  if(this.overflow)this.attribute.clearUpdateRanges();
  else for(let i=0;i<this.pendingCount;i++)this.attribute.addUpdateRange(this.pendingOffsets[i],this.pendingLengths[i]);
  this.attribute.needsUpdate=true;
  this.pendingCount=0;this.overflow=false;
 }
 free(urlIndex:number){
  const slot=this.slots[urlIndex];
  if(!slot)return;
  this.slots[urlIndex]=undefined;
  this.allocator.release(slot.offset,slot.length);
 }
 dispose(){
  for(const name of Object.keys(this.geometry.attributes))this.geometry.deleteAttribute(name);
  this.geometry.dispose();
 }
}

/** Un groupe = une instance de primitive, c'est-à-dire un `renderOrder`, exactement comme avant. */
class BatchGroup{
 primitive:PrimitiveIndex;
 ranges=new DrawRanges();
 mesh:ClusterDrawMesh|undefined;
 sample:BatchPage|undefined;
 attached=false;
 touched=false;
 triangles=0;
 transparent=false;
 pending:BatchPage[]=[];
 pendingCount=0;
 constructor(primitive:PrimitiveIndex){this.primitive=primitive;}
}

const bySourceOrder=(a:BatchPage,b:BatchPage)=>(a.sourceOrder??a.id)-(b.sourceOrder??b.id);

export type ClusterBatchStats={
 drawCalls:number;
 subDraws:number;
 submittedTriangles:number;
 allocationBytes:number;
 pageRangeWrites:number;
 indexBytesWritten:number;
 detachments:number;
};

type PrimitiveDraft={
 attributes:THREE.BufferGeometry['attributes'];
 urls:Map<string,number>;
 lengths:number[];
 urlIndexByPage:number[];
 pages:number;
 min:[number,number,number];
 max:[number,number,number];
};

/** Ensemble des lots d'une scène : un tampon d'index par primitive, un objet de dessin par instance. */
export class ClusterBatches{
 private scene:THREE.Scene;
 private primitives:PrimitiveIndex[]=[];
 private groups:Array<BatchGroup|undefined>=[];
 private active:BatchGroup[]=[];
 private touched:BatchGroup[]=[];
 private matrices=identityMatrixTexture();
 private indirect:THREE.DataTexture;
 private attributeBytes=0;
 private indexCapacityBytes=0;
 private stats:ClusterBatchStats={drawCalls:0,subDraws:0,submittedTriangles:0,allocationBytes:0,pageRangeWrites:0,indexBytesWritten:0,detachments:0};

 constructor(scene:THREE.Scene,pages:readonly BatchPage[]){
  this.scene=scene;
  const drafts=new Map<THREE.BufferGeometry['attributes'],PrimitiveDraft>();
  const groupDrafts:Array<{draft:PrimitiveDraft;transparent:boolean}|undefined>=[];
  let maxDraws=1;
  for(const page of pages){
   let draft=drafts.get(page.attributes);
   if(!draft){
    draft={attributes:page.attributes,urls:new Map(),lengths:[],urlIndexByPage:[],pages:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    drafts.set(page.attributes,draft);
   }
   let urlIndex=draft.urls.get(page.url);
   if(urlIndex===undefined){urlIndex=draft.lengths.length;draft.urls.set(page.url,urlIndex);draft.lengths.push(page.triangles*3);}
   if(draft.urlIndexByPage[page.id]===undefined){draft.urlIndexByPage[page.id]=urlIndex;draft.pages++;}
   for(let axis=0;axis<3;axis++){
    if(page.min[axis]<draft.min[axis])draft.min[axis]=page.min[axis];
    if(page.max[axis]>draft.max[axis])draft.max[axis]=page.max[axis];
   }
   if(draft.pages>maxDraws)maxDraws=draft.pages;
   if(!groupDrafts[page.renderOrder])groupDrafts[page.renderOrder]={draft,transparent:!!page.transparent};
  }
  this.indirect=zeroIndirectTexture(maxDraws);
  const built=new Map<PrimitiveDraft,PrimitiveIndex>();
  const seen=new Set<ArrayBufferView>();
  for(const draft of drafts.values()){
   const urlIndexByPage=new Int32Array(draft.urlIndexByPage.length);
   for(let i=0;i<urlIndexByPage.length;i++)urlIndexByPage[i]=draft.urlIndexByPage[i]??-1;
   const bounds=new THREE.Box3(new THREE.Vector3().fromArray(draft.min),new THREE.Vector3().fromArray(draft.max));
   const primitive=new PrimitiveIndex(draft.attributes,urlIndexByPage,Int32Array.from(draft.lengths),bounds);
   built.set(draft,primitive);
   this.primitives.push(primitive);
   this.indexCapacityBytes+=primitive.array.byteLength;
   for(const name in draft.attributes){
    const array=(draft.attributes[name] as THREE.BufferAttribute|undefined)?.array as ArrayBufferView|undefined;
    if(!array||seen.has(array))continue;
    seen.add(array);this.attributeBytes+=array.byteLength;
   }
  }
  for(let order=0;order<groupDrafts.length;order++){
   const entry=groupDrafts[order];
   if(!entry)continue;
   const group=new BatchGroup(built.get(entry.draft)!);
   group.transparent=entry.transparent;
   this.groups[order]=group;
  }
  // Les pages déjà résidentes à la construction (cache complet en mémoire) reçoivent leur plage tout de suite.
  for(const page of pages)if(page.array)this.acceptPage([page],page.array);
  this.stats.allocationBytes=this.indexCapacityBytes+this.attributeBytes;
 }

 get metrics():Readonly<ClusterBatchStats>{return this.stats;}
 /** Capacité résidente des tampons d'index, en octets. Relue après une croissance éventuelle. */
 get indexBytes(){let bytes=0;for(let i=0;i<this.primitives.length;i++)bytes+=this.primitives[i].array.byteLength;return bytes;}

 /** Écrit la plage d'une page devenue résidente. Aucune autre partie du tampon n'est touchée. */
 acceptPage(recs:readonly BatchPage[],array:Uint32Array){
  for(const rec of recs){
   const group=this.groups[rec.renderOrder];
   if(!group)continue;
   const urlIndex=group.primitive.urlIndexByPage[rec.id];
   if(urlIndex<0||group.primitive.slots[urlIndex])continue;
   const capacity=group.primitive.array.byteLength;
   group.primitive.reserve(urlIndex,array);
   this.indexCapacityBytes+=group.primitive.array.byteLength-capacity;
   this.stats.pageRangeWrites++;
   this.stats.indexBytesWritten+=array.byteLength;
  }
 }

 /** Rend la plage d'une page évincée à l'allocateur de sa primitive. */
 dropPage(recs:readonly BatchPage[]){
  for(const rec of recs){
   const group=this.groups[rec.renderOrder];
   if(!group)continue;
   const urlIndex=group.primitive.urlIndexByPage[rec.id];
   if(urlIndex<0)continue;
   group.primitive.free(urlIndex);
  }
 }

 /** Liste les URL d'une coupe sans Set : une estampille par page distincte de chaque primitive. */
 markUrls(pages:readonly BatchPage[],stamp:number,into:string[]){
  for(let i=0;i<pages.length;i++){
   const rec=pages[i];
   const group=this.groups[rec.renderOrder];
   const urlIndex=group?group.primitive.urlIndexByPage[rec.id]:-1;
   if(!group||urlIndex<0){into.push(rec.url);continue;}
   const stamps=group.primitive.stamps;
   if(stamps[urlIndex]===stamp)continue;
   stamps[urlIndex]=stamp;
   into.push(rec.url);
  }
  return into;
 }

 /** Construit la coupe de l'image : uniquement des listes starts/counts, aucun index n'est recopié. */
 update(display:readonly BatchPage[]){
  const touched=this.touched;touched.length=0;
  for(let i=0;i<display.length;i++){
   const rec=display[i];
   if(!rec.array)continue;
   const group=this.groups[rec.renderOrder];
   if(!group)continue;
   const urlIndex=group.primitive.urlIndexByPage[rec.id];
   if(urlIndex<0)continue;
   const slot=group.primitive.slots[urlIndex];
   if(!slot)continue;
   if(!group.touched){group.touched=true;group.ranges.reset();group.triangles=0;group.pendingCount=0;group.sample=rec;touched.push(group);}
   if(group.transparent){group.pending[group.pendingCount++]=rec;continue;}
   group.ranges.push(slot.offset,slot.length);
   group.triangles+=rec.triangles;
  }
  // Les groupes transparents gardent l'ordre source : multi-draw dessine les plages dans l'ordre donné.
  for(let i=0;i<touched.length;i++){
   const group=touched[i];
   if(!group.transparent)continue;
   const pending=group.pending;
   pending.length=group.pendingCount;
   pending.sort(bySourceOrder);
   for(let k=0;k<pending.length;k++){
    const rec=pending[k];
    const slot=group.primitive.slots[group.primitive.urlIndexByPage[rec.id]]!;
    group.ranges.push(slot.offset,slot.length);
    group.triangles+=rec.triangles;
   }
  }
  const active=this.active;
  for(let i=0;i<active.length;i++){
   const group=active[i];
   if(group.touched||!group.attached||!group.mesh)continue;
   this.scene.remove(group.mesh);group.attached=false;this.stats.detachments++;
  }
  let draws=0,subDraws=0,triangles=0;
  for(let i=0;i<touched.length;i++){
   const group=touched[i];
   group.touched=false;
   const sample=group.sample!;
   let mesh=group.mesh;
   if(!mesh){
    mesh=new ClusterDrawMesh(group.primitive.geometry,sample.material,group.ranges,this.matrices,this.indirect);
    mesh.renderOrder=sample.renderOrder;
    mesh.userData.clusterId=String(sample.renderOrder);
    mesh.userData.lodRole='exact';
    group.mesh=mesh;
   }else if(mesh.material!==sample.material)mesh.material=sample.material;
   mesh.matrix.copy(sample.matrix);
   // Les tableaux sont réutilisés ; leur identité ne change que lorsqu'ils ont dû grandir.
   mesh._multiDrawStarts=group.ranges.starts;
   mesh._multiDrawCounts=group.ranges.counts;
   mesh._multiDrawCount=group.ranges.count;
   if(!group.attached){this.scene.add(mesh);group.attached=true;}
   group.primitive.flush();
   draws++;subDraws+=group.ranges.count;triangles+=group.triangles;
  }
  this.touched=active;this.active=touched;
  this.stats.drawCalls=draws;this.stats.subDraws=subDraws;this.stats.submittedTriangles=triangles;
  this.stats.allocationBytes=this.indexCapacityBytes+this.attributeBytes;
 }

 /** Modes diagnostic : les lots disparaissent, les pages sont dessinées une à une par l'appelant. */
 hideAll(){
  const active=this.active;
  for(let i=0;i<active.length;i++){
   const group=active[i];
   if(!group.attached||!group.mesh)continue;
   this.scene.remove(group.mesh);group.attached=false;this.stats.detachments++;
  }
  active.length=0;
  this.stats.drawCalls=0;this.stats.subDraws=0;this.stats.submittedTriangles=0;
 }

 dispose(){
  this.hideAll();
  for(const group of this.groups)if(group)group.mesh=undefined;
  for(const primitive of this.primitives)primitive.dispose();
  this.primitives.length=0;this.groups.length=0;
  this.matrices.dispose();this.indirect.dispose();
 }
}
