// The oracle of the curved comparison: the same metal sphere, shaded by a reference GLSL program at
// eight times the resolution and averaged down in linear light. The engine's image and the
// witness's are measured against it, still (spatial) and from frame to frame (temporal).
import * as THREE from 'three'
import { curvedComparison, curvedPixels, witnessRenderer } from './clusterCurved.ts'

const VERTEX = `precision highp float;varying vec3 p,n;void main(){vec4 v=modelViewMatrix*vec4(position,1.);p=v.xyz;n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*v;}`
const FRAGMENT = `precision highp float;varying vec3 p,n;const float PI=3.141592653589793;
vec3 F(float h,vec3 f0){return f0+(1.-f0)*pow(max(0.,1.-h),5.);}
vec3 srgb(vec3 x){return mix(1.055*pow(max(x,vec3(0.)),vec3(1./2.4))-.055,12.92*x,lessThanEqual(x,vec3(.0031308)));}
void main(){vec3 N=normalize(n),V=normalize(-p),L=normalize(vec3(1.,1.,2.)),H=normalize(V+L),base=vec3(.18),f0=mix(vec3(.04),base,.8);
float nl=max(dot(N,L),0.),nv=max(dot(N,V),1e-4),nh=max(dot(N,H),0.),vh=max(dot(V,H),0.),a=.35*.35,a2=a*a;
float d0=nh*nh*(a2-1.)+1.,D=a2/(PI*d0*d0),gv=nl*sqrt(nv*nv*(1.-a2)+a2),gl=nv*sqrt(nl*nl*(1.-a2)+a2),vis=.5/(gv+gl+1e-7);
vec3 fres=F(vh,f0),rgb=((1.-fres)*base*.2/PI+D*vis*fres)*nl;gl_FragColor=vec4(srgb(rgb),1.);}`

const srgbToLinear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
const linearToSrgb = (value: number) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055

/** The sphere `offset` to the side in a `size`² view, shaded at `scale`× and box-filtered in
 *  linear light down to `size`. */
const oracle = (size: number, offset: number, scale: number) => {
  const renderer = witnessRenderer(size * scale),
    geometry = new THREE.SphereGeometry(1, 32, 16),
    material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT }),
    mesh = new THREE.Mesh(geometry, material),
    scene = new THREE.Scene()
  mesh.position.set(offset, 0, -3)
  scene.add(mesh)
  renderer.render(scene, new THREE.PerspectiveCamera(60, 1, 0.1, 10))
  const high = curvedPixels(renderer.getContext(), size * scale),
    low = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const out = (y * size + x) * 4
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let j = 0; j < scale; j++)
          for (let i = 0; i < scale; i++)
            sum += srgbToLinear(
              high[((y * scale + j) * size * scale + x * scale + i) * 4 + c] / 255,
            )
        low[out + c] = Math.round(linearToSrgb(sum / (scale * scale)) * 255)
      }
      low[out + 3] = 255
    }
  renderer.dispose()
  geometry.dispose()
  material.dispose()
  return low
}

/** The RMS and largest channel gap of `images` to `oracles`, frame by frame; `temporal`, of their
 *  frame-to-frame changes instead. */
const errors = (images: Uint8Array[], oracles: Uint8Array[], temporal = false) => {
  let sum = 0,
    count = 0,
    max = 0
  for (let frame = temporal ? 1 : 0; frame < images.length; frame++)
    for (let i = 0; i < oracles[frame].length; i += 4)
      for (let c = 0; c < 3; c++) {
        const actual = images[frame][i + c] - (temporal ? images[frame - 1][i + c] : 0),
          expected = oracles[frame][i + c] - (temporal ? oracles[frame - 1][i + c] : 0),
          delta = Math.abs(actual - expected)
        sum += delta * delta
        count++
        max = Math.max(max, delta)
      }
  return { rms: Math.sqrt(sum / count), max }
}

/** Five frames of the sphere sliding a hundredth at a time, the engine's and the witness's
 *  images against the oracle's. */
export function curvedOracleQuality() {
  const size = 128,
    offsets = [-0.02, -0.01, 0, 0.01, 0.02],
    frames = offsets.map((offset) => {
      const read = curvedComparison(size, offset, true)
      if (!('raw' in read)) throw new Error('the comparison returned no image')
      return read
    }),
    oracles = offsets.map((offset) => oracle(size, offset, 8)),
    owned = frames.map((frame) => frame.raw),
    witness = frames.map((frame) => frame.reference)
  return {
    spatial: { owned: errors(owned, oracles), witness: errors(witness, oracles) },
    temporal: { owned: errors(owned, oracles, true), witness: errors(witness, oracles, true) },
  }
}
