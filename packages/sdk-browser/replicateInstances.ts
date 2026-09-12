import * as THREE from 'three';
/** Replicate transforms only. Geometry, materials and textures remain shared. */
export function replicateInstances(source: THREE.Object3D, associations: Map<THREE.Object3D, {meshes?:number;primitives?:number}>, count: 1|4|9) {
 if (![1,4,9].includes(count)) throw new Error('Replica count must be 1, 4 or 9');
 source.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(source),size=bounds.getSize(new THREE.Vector3());
 if(count===1)return source;
 const width=Math.sqrt(count),group=new THREE.Group(),meshes:THREE.Mesh[]=[];
 source.traverse(object=>{if((object as THREE.Mesh).isMesh)meshes.push(object as THREE.Mesh);});
 for(let z=0;z<width;z++)for(let x=0;x<width;x++)for(const mesh of meshes){
  const copy=new THREE.Mesh(mesh.geometry,mesh.material);copy.matrixAutoUpdate=false;copy.matrix.copy(mesh.matrixWorld);
  copy.matrix.elements[12]+=(x-(width-1)/2)*size.x;copy.matrix.elements[14]+=(z-(width-1)/2)*size.z;
  const association=associations.get(mesh);if(association)associations.set(copy,association);group.add(copy);
 }
 group.updateMatrixWorld(true);return group;
}
