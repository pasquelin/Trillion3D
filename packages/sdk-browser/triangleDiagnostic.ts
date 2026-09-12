import * as THREE from 'three';

const cache=new WeakMap<THREE.BufferGeometry,THREE.BufferGeometry>();

function fract(value:number){return value-Math.floor(value);}
function hashColor(id:number){
 return [fract(Math.sin(id*12.9898)*43758.5453),fract(Math.sin(id*78.233)*43758.5453),fract(Math.sin(id*45.164)*43758.5453)] as const;
}

export function triangleSalt(id:string){
 let h=0;for(let i=0;i<id.length;i++)h=(Math.imul(h,31)+id.charCodeAt(i))>>>0;
 return (h%100000)/10;
}

export function triangleGeometry(geometry:THREE.BufferGeometry,salt=0){
 if(!geometry.index){
  if(!geometry.getAttribute('color'))colorTriangles(geometry,salt);
  return geometry;
 }
 const key=geometry;
 let copy=cache.get(key);
 if(!copy){copy=geometry.toNonIndexed();colorTriangles(copy,salt);cache.set(key,copy);}
 return copy;
}

function colorTriangles(geometry:THREE.BufferGeometry,salt:number){
 const count=geometry.getAttribute('position').count;
 const colors=new Float32Array(count*3);
 for(let i=0;i<count;i+=3){
  const [r,g,b]=hashColor(i/3+salt);
  for(let corner=0;corner<3;corner++){
   const offset=(i+corner)*3;
   colors[offset]=r;colors[offset+1]=g;colors[offset+2]=b;
  }
 }
 geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
}

export function createTriangleDiagnosticMaterial(side:THREE.Side,_salt=0){
 return new THREE.MeshLambertMaterial({vertexColors:true,side,toneMapped:false,fog:false});
}

export function materialSide(material:THREE.Material|THREE.Material[]){
 return Array.isArray(material)?material[0].side:material.side;
}

export function disposeTriangleGeometry(geometry:THREE.BufferGeometry){
 const copy=cache.get(geometry);
 if(copy&&copy!==geometry){copy.dispose();cache.delete(geometry);}
}
