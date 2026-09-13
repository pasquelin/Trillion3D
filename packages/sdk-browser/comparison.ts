import * as THREE from 'three';

export type ComparisonLayout='single'|'side-by-side'|'wipe'|'toggle'|'difference';

const vertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
const fragment=`precision highp float;varying vec2 vUv;uniform sampler2D mapA;uniform sampler2D mapB;uniform int layout;uniform float wipe;uniform int toggle;
void main(){
 vec2 uv=vUv;
 if(layout==1){
  if(uv.x<0.5){gl_FragColor=texture2D(mapA,vec2(uv.x*2.0,uv.y));}
  else{gl_FragColor=texture2D(mapB,vec2((uv.x-0.5)*2.0,uv.y));}
  return;
 }
 if(layout==2){gl_FragColor=uv.x<wipe?texture2D(mapA,uv):texture2D(mapB,uv);return;}
 if(layout==3){gl_FragColor=toggle==0?texture2D(mapA,uv):texture2D(mapB,uv);return;}
 if(layout==4){
  vec4 a=texture2D(mapA,uv);vec4 b=texture2D(mapB,uv);
  gl_FragColor=vec4(abs(a.rgb-b.rgb),1.0);return;
 }
 gl_FragColor=texture2D(mapA,uv);
}`;

export function createComparisonCompositor(renderer:THREE.WebGLRenderer){
 const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
 const scene=new THREE.Scene();
 const material=new THREE.ShaderMaterial({uniforms:{mapA:{value:null},mapB:{value:null},layout:{value:0},wipe:{value:.5},toggle:{value:0}},vertexShader:vertex,fragmentShader:fragment,depthTest:false,depthWrite:false});
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);mesh.frustumCulled=false;scene.add(mesh);
 const layoutId=(layout:ComparisonLayout)=>layout==='side-by-side'?1:layout==='wipe'?2:layout==='toggle'?3:layout==='difference'?4:0;
 return {
  render(mapA:THREE.Texture,mapB:THREE.Texture,layout:ComparisonLayout,wipe:number,toggle:0|1){
   material.uniforms.mapA.value=mapA;material.uniforms.mapB.value=mapB;material.uniforms.layout.value=layoutId(layout);
   material.uniforms.wipe.value=Math.min(1,Math.max(0,wipe));material.uniforms.toggle.value=toggle;
   renderer.setRenderTarget(null);renderer.render(scene,camera);
  },
  dispose(){material.dispose();mesh.geometry.dispose();},
 };
}
