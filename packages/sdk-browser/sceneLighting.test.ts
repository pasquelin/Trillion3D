import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {packSceneLights,installSceneLighting} from './sceneLighting.ts';

test('light packing preserves world transforms, linear color, intensity and spot range',()=>{
 const source=new THREE.Group(),parent=new THREE.Group();parent.position.set(10,2,0);source.add(parent);
 const spot=new THREE.SpotLight(new THREE.Color().setRGB(.25,.5,1),3,20,Math.PI/3,.5,2);spot.position.set(0,3,0);parent.add(spot);spot.target.position.set(10,0,0);source.add(spot.target);
 const {count,data}=packSceneLights(source);
 assert.equal(count,1);assert.deepEqual([...data.slice(4,12)],[10,5,0,3,.25,.5,1,3]);
 assert.deepEqual([...data.slice(12,16)],[0,1,0,20]);
 assert.ok(Math.abs(data[20]-.5)<1e-6);assert.ok(Math.abs(data[21]-Math.sqrt(3)/2)<1e-6);
 spot.intensity=0;assert.equal(packSceneLights(source).data[11],0,'an extinguished light must not activate the default rig');
});

test('Three reference and GPU adapter use the same directional target in world space',()=>{
 const source=new THREE.Group(),parent=new THREE.Group();parent.position.set(4,0,0);source.add(parent);
 const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(1,3,2);parent.add(sun);sun.target.position.set(4,0,0);source.add(sun.target);
 const reference=new THREE.Scene();installSceneLighting(reference,source,0);
 const copy=reference.children.find(object=>object instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
 assert.deepEqual(copy.position.toArray(),[5,3,2]);assert.deepEqual(copy.target.position.toArray(),[4,0,0]);
 const packed=packSceneLights(source).data;
 for(const [i,value] of [1,3,2].entries())assert.ok(Math.abs(packed[12+i]-value/Math.sqrt(14))<1e-6);
});

test('unsupported and excessive lights fail explicitly instead of being silently omitted',()=>{
 const source=new THREE.Group();source.add(new THREE.RectAreaLight());assert.throws(()=>packSceneLights(source),/UNSUPPORTED_SCENE_LIGHT/);
 source.clear();for(let i=0;i<257;i++)source.add(new THREE.PointLight());assert.throws(()=>packSceneLights(source),/LIGHT_BUDGET/);
});

test('hiding all authored lights leaves the scene dark instead of restoring the default rig',()=>{
 const source=new THREE.Group(),sun=new THREE.DirectionalLight();source.add(sun);sun.visible=false;
 assert.equal(packSceneLights(source).count,0);
});
