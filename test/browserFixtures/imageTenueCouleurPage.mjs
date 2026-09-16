// Côté page de la preuve : un vrai rendu WebGL dans Chromium, la chaîne d'affichage du moteur —
// sortie sRGB, ACES dès qu'une lampe existe — et le vrai module d'image tenue.
//
// L'image complète est rendue puis relue au pixel près ; la même image est ensuite gardée et
// réaffichée par le quad plein écran, et relue aux mêmes points. Les deux relevés doivent être
// identiques octet pour octet : la copie porte déjà la sortie d'affichage, la réafficher ne doit ni
// la réencoder ni la retonemapper.
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

/** Les octets RGBA du tampon de dessin aux points de contrôle, relus juste après la soumission. */
function lire(gl) {
  return POINTS.map(([x, y]) => {
    const octets = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, octets);
    return [...octets];
  });
}

/** Deux plans de couleurs différentes, éclairés ou non selon ce que le cas demande. */
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

/** Un cas : une image complète, puis la même image tenue. Rend les deux relevés de pixels. */
function cas(renderer, gl, eclairee) {
  // La chaîne d'affichage du moteur : ACES n'est le dernier maillon que si une lampe existe.
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
  const relevés = [];
  // Plusieurs images tenues d'affilée : chacune relit ce qu'elle vient de poser, sans dériver.
  for (let i = 0; i < 3; i++) {
    tenue.present(renderer);
    relevés.push(lire(gl));
  }
  monde.traverse((objet) => {
    objet.geometry?.dispose();
    objet.material?.dispose();
  });
  return { eclairee, complete, tenues: relevés };
}

export async function executer() {
  const canvas = document.createElement('canvas');
  canvas.width = LARGEUR;
  canvas.height = HAUTEUR;
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(LARGEUR, HAUTEUR, false);
  // La sortie du moteur : sRGB. C'est elle que la copie porte déjà.
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
