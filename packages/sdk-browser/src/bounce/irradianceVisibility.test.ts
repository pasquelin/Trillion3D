import test from 'node:test';
import assert from 'node:assert/strict';
import { SURFACE_IRRADIANCE_WGSL } from './irradianceWgsl.ts';
import { functionText } from './wgslBody.fixture.ts';

type Light = {
  energy: number;
  distance: number;
  casts?: boolean;
  sun?: boolean;
  rectangle?: boolean;
};

// Execute the production loop on collinear lights and a planar blocker. A scalar channel is
// sufficient: the visibility decision multiplies all three channels identically. Incidence
// and rectangle integration are controlled separately from the control flow under test.
const body = functionText(SURFACE_IRRADIANCE_WGSL, 'directIrradiance')
  .replace(/\b(\d+)u\b/g, '$1')
  .replace(/\bvar\b/g, 'let');
const run = new Function(
  'lights',
  'wall',
  'reach',
  `
 const vec3f=x=>x, dot=(a,b)=>a*b, length=Math.abs, select=(a,b,p)=>p?b:a;
 const isRect=l=>l.rectangle, isSun=l=>l.sun;
 const directIncidence=l=>({xyz:Math.sign(l.positionRange.xyz),w:1});
 const rectIrradiance=()=>({w:1});
 const rays=[];
 const proxyBlocked=(origin,direction,span)=>{
   rays.push(span);
   const hit=(wall-origin)/direction;
   return hit>0&&hit<span;
 };
 const directLights={count:lights.length,items:lights.map(l=>({
   ...l,params:{z:l.casts===false?0:1},positionRange:{xyz:l.distance},
   colorIntensity:{rgb:l.energy,w:1}
 }))};
 function directIrradiance(P,N,reach){${body.slice(body.indexOf('{') + 1)}}
 return {value:directIrradiance(0,1,reach),rays};
`,
) as (lights: Light[], wall: number, reach: number) => { value: number; rays: number[] };

test('fifth and later shadow-casting lights cannot bleed through a wall, in either light order', () => {
  const lights = [2, 3, 4, 5, 6, 7].map((distance, i) => ({ distance, energy: i + 1 }));
  assert.equal(run(lights, 5.5, 20).value, 10, 'only the four lights before the wall contribute');
  assert.equal(run([...lights].reverse(), 5.5, 20).value, 10, 'ordering cannot change visibility');
  assert.equal(run(lights, 1, 20).value, 0, 'a closed wall blocks every light');
  assert.equal(run(lights, 10, 20).value, 21, 'all unoccluded contributions remain');
});

test('a sun after four local lights uses scene reach; castless and area lights retain their contract', () => {
  const near = Array.from({ length: 4 }, () => ({ distance: 2, energy: 1 }));
  assert.equal(run([...near, { distance: 1, energy: 30, sun: true }], 5, 20).value, 4);
  assert.equal(run([...near, { distance: 10, energy: 30, casts: false }], 5, 20).value, 34);
  assert.equal(run([...near, { distance: 10, energy: 30, rectangle: true }], 5, 20).value, 34);
  assert.deepEqual(run([{ distance: -10, energy: 30 }], 5, 20), { value: 0, rays: [] });
});
