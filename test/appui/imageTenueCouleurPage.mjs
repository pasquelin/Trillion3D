// Page side of the proof: a real WebGL render in Chromium, the engine's display chain — sRGB
// output, ACES as soon as a light exists — and the real held-image module.
//
// The complete image is rendered then reread pixel for pixel; the same image is then kept and
// re-presented by the full-screen quad, and reread at the same points. The two readings must be
// identical byte for byte: the copy already carries the display output, re-presenting it must
// neither re-encode nor re-tone-map it.
import * as THREE from 'three';
import { createHeldFrame } from '../../packages/sdk-browser/explorerHeldFrame.ts';

const LARGEUR = 256,
  HAUTEUR = 192;
const POINTS = [
  [LARGEUR >> 1, HAUTEUR >> 1],
  [LARGEUR >> 3, HAUTEUR >> 3],
  [(7 * LARGEUR) >> 3, (7 * HAUTEUR) >> 3],
  [LARGEUR >> 2, (3 * HAUTEUR) >> 2],
];

/** RGBA bytes of the draw buffer at the control points, reread just after submit. */
function lire(gl) {
  return POINTS.map(([x, y]) => {
    const octets = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, octets);
    return [...octets];
  });
}

/** Two planes of different colours, lit or not according to what the case asks. */
function scene(eclairee) {
  const scene = new THREE.Scene();
  const materiau = (couleur) =>
    eclairee
      ? new THREE.MeshStandardMaterial({ color: couleur, roughness: 0.6 })
      : new THREE.MeshBasicMaterial({ color: couleur });
  const fond = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), materiau(0x336699));
  const carre = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), materiau(0xcc8844));
  carre.position.set(-0.6, 0.4, 0.5);
  scene.add(fond, carre);
  if (eclairee) {
    const lampe = new THREE.DirectionalLight(0xffffff, 2.5);
    lampe.position.set(1, 2, 3);
    scene.add(lampe, new THREE.AmbientLight(0xffffff, 0.3));
  }
  return scene;
}

/** One case: a complete image, then the same image held. Returns both pixel readings. */
function cas(renderer, gl, eclairee) {
  // The engine's display chain: ACES is the last link only if a light exists.
  renderer.toneMapping = eclairee ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  const camera = new THREE.PerspectiveCamera(50, LARGEUR / HAUTEUR, 0.1, 100);
  camera.position.z = 3;
  camera.updateMatrixWorld(true);
  const monde = scene(eclairee);
  const tenue = createHeldFrame();
  const taille = new THREE.Vector2();
  renderer.getDrawingBufferSize(taille);
  renderer.render(monde, camera);
  const complete = lire(gl);
  tenue.keep(renderer, taille);
  const readings = [];
  // Several held images in a row: each rereads what it just posed, without drifting.
  for (let i = 0; i < 3; i++) {
    tenue.present(renderer);
    readings.push(lire(gl));
  }
  monde.traverse((objet) => {
    objet.geometry?.dispose();
    objet.material?.dispose();
  });
  return { eclairee, complete, tenues: readings };
}

export async function executer() {
  const canvas = document.createElement('canvas');
  canvas.width = LARGEUR;
  canvas.height = HAUTEUR;
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(LARGEUR, HAUTEUR, false);
  // The engine's output: sRGB. That is what the copy already carries.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMappingExposure = 1;
  const gl = renderer.getContext();
  try {
    return { cas: [cas(renderer, gl, false), cas(renderer, gl, true)] };
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? '') };
  } finally {
    renderer.dispose();
    canvas.remove();
  }
}
