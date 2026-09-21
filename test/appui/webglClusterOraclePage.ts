import * as THREE from 'three';
import { curvedComparison, curvedPixels } from './webglClusterCurvedPage.ts';

/** `curvedComparison(..., true)` either finds no WebGL2 or returns the detailed comparison,
 *  `raw`/`reference` included; the oracle only ever calls it with `details: true`. */
function mustDetailed(result: ReturnType<typeof curvedComparison>) {
  if ('unavailable' in result) throw new Error(result.unavailable);
  if (!('raw' in result) || !('reference' in result))
    throw new Error('curvedComparison missing raw/reference detail');
  return result as typeof result & { raw: Uint8Array; reference: Uint8Array };
}

const VERTEX = `precision highp float;varying vec3 p,n;void main(){vec4 v=modelViewMatrix*vec4(position,1.);p=v.xyz;n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*v;}`;
const FRAGMENT = `precision highp float;varying vec3 p,n;const float PI=3.141592653589793;
vec3 F(float h,vec3 f0){return f0+(1.-f0)*pow(max(0.,1.-h),5.);}
vec3 srgb(vec3 x){return mix(1.055*pow(max(x,vec3(0.)),vec3(1./2.4))-.055,12.92*x,lessThanEqual(x,vec3(.0031308)));}
void main(){vec3 N=normalize(n),V=normalize(-p),L=normalize(vec3(1.,1.,2.)),H=normalize(V+L),base=vec3(.18),f0=mix(vec3(.04),base,.8);
float nl=max(dot(N,L),0.),nv=max(dot(N,V),1e-4),nh=max(dot(N,H),0.),vh=max(dot(V,H),0.),a=.35*.35,a2=a*a;
float d0=nh*nh*(a2-1.)+1.,D=a2/(PI*d0*d0),gv=nl*sqrt(nv*nv*(1.-a2)+a2),gl=nv*sqrt(nl*nl*(1.-a2)+a2),vis=.5/(gv+gl+1e-7);
vec3 fres=F(vh,f0),rgb=((1.-fres)*base*.2/PI+D*vis*fres)*nl;gl_FragColor=vec4(srgb(rgb),1.);}`;

const srgbToLinear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
const linearToSrgb = (value: number) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;

const oracle = (size: number, offset: number, scale: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * scale;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false }),
    geometry = new THREE.SphereGeometry(1, 32, 16),
    material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT }),
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10),
    mesh = new THREE.Mesh(geometry, material),
    scene = new THREE.Scene();
  mesh.position.set(offset, 0, -3);
  scene.add(mesh);
  renderer.setClearColor(0, 1);
  renderer.render(scene, camera);
  const high = curvedPixels(renderer.getContext(), size * scale),
    low = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const out = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let j = 0; j < scale; j++)
          for (let i = 0; i < scale; i++)
            sum += srgbToLinear(
              high[((y * scale + j) * size * scale + x * scale + i) * 4 + c] / 255,
            );
        low[out + c] = Math.round(linearToSrgb(sum / (scale * scale)) * 255);
      }
      low[out + 3] = 255;
    }
  renderer.dispose();
  geometry.dispose();
  material.dispose();
  return low;
};

const errors = (
  frames: Record<string, unknown>[],
  key: string,
  oracles: Uint8Array[],
  temporal = false,
) => {
  const pixelsAt = (frame: number) => frames[frame][key] as Uint8Array;
  let sum = 0,
    count = 0,
    max = 0;
  for (let frame = temporal ? 1 : 0; frame < frames.length; frame++)
    for (let i = 0; i < oracles[frame].length; i += 4)
      for (let c = 0; c < 3; c++) {
        const actual = pixelsAt(frame)[i + c] - (temporal ? pixelsAt(frame - 1)[i + c] : 0),
          expected = oracles[frame][i + c] - (temporal ? oracles[frame - 1][i + c] : 0),
          delta = Math.abs(actual - expected);
        sum += delta * delta;
        count++;
        max = Math.max(max, delta);
      }
  return { rms: Math.sqrt(sum / count), max };
};

export function curvedOracleQuality() {
  const size = 128,
    offsets = [-0.02, -0.01, 0, 0.01, 0.02],
    frames = offsets.map((offset) => mustDetailed(curvedComparison(size, offset, true))),
    oracles = offsets.map((offset) => oracle(size, offset, 8)),
    oracle4 = offsets.map((offset) => ({ value: oracle(size, offset, 4) }));
  return {
    spatial: {
      owned: errors(frames, 'raw', oracles),
      witness: errors(frames, 'reference', oracles),
    },
    temporal: {
      owned: errors(frames, 'raw', oracles, true),
      witness: errors(frames, 'reference', oracles, true),
    },
    convergence: errors(oracle4, 'value', oracles),
  };
}
