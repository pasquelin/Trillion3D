import * as THREE from 'three';

const canvasTexture = (width, paint) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  paint(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  return texture;
};

const draw = (renderer, gl, mesh, scene, camera, material, pixel) => {
  mesh.material = material;
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, camera, false, true);
  return pixel(gl, 16, 16);
};

export function textureFixtures(renderer, gl, mesh, scene, camera, pixel) {
  const previous = mesh.material,
    linear = canvasTexture(1, (context) => {
      context.fillStyle = 'rgb(46,46,46)';
      context.fillRect(0, 0, 1, 1);
    }),
    basic = new THREE.MeshBasicMaterial({ color: 0xffffff, map: linear }),
    linearMap = draw(renderer, gl, mesh, scene, camera, basic, pixel),
    emissiveMaterial = new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffffff });
  emissiveMaterial.emissiveMap = linear;
  const linearEmissive = draw(renderer, gl, mesh, scene, camera, emissiveMaterial, pixel),
    indexed = canvasTexture(4, (context) => {
      for (const [index, color] of ['red', 'lime', 'blue', 'yellow'].entries()) {
        context.fillStyle = color;
        context.fillRect(index, 0, 1, 1);
      }
    });
  indexed.channel = 1;
  indexed.wrapS = THREE.RepeatWrapping;
  indexed.offset.x = 0.5;
  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6).fill(0.125), 2));
  mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(6).fill(0.375), 2));
  const uvMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, map: indexed }),
    uv1Transform = draw(renderer, gl, mesh, scene, camera, uvMaterial, pixel);
  mesh.material = previous;
  basic.dispose();
  emissiveMaterial.dispose();
  uvMaterial.dispose();
  linear.dispose();
  indexed.dispose();
  return { linearMap, linearEmissive, uv1Transform };
}
