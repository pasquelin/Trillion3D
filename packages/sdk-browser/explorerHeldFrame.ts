import * as THREE from 'three';

/**
 * L'image tenue d'un moteur rendu par Three.
 *
 * Un tel moteur ne soumet rien lui-même : c'est l'hôte qui rend le graphe qu'il tient, et une image
 * tenue redessinait donc la scène entière alors que le moteur avait déjà répondu qu'elle ne pouvait
 * pas changer. Le contenu du canevas, lui, ne survit pas d'une image à l'autre — `preserveDrawingBuffer`
 * est faux, et compter dessus reviendrait à afficher ce que le navigateur voudra bien garder.
 *
 * Ce qui est gardé est donc une copie explicite : la dernière image complète est recopiée du tampon
 * de dessin vers une texture, et une image tenue la réaffiche par un quad plein écran — une seule
 * commande de dessin, aucune géométrie de scène, aucun matériau de la scène. La copie coûte une
 * image entière de bande passante ; elle n'a lieu qu'après une image complète, jamais après une
 * image tenue, qui ne fait que relire ce qu'elle vient de reposer.
 */
export function createHeldFrame() {
  let texture: THREE.FramebufferTexture | undefined,
    width = 0,
    height = 0,
    kept = false;
  const material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  return {
    /** Vrai quand une image complète a été gardée à la taille courante du tampon de dessin. */
    holds(size: THREE.Vector2) {
      return kept && size.x === width && size.y === height;
    },
    /** Garde l'image complète qui vient d'être soumise, en recopiant le tampon de dessin. */
    keep(renderer: THREE.WebGLRenderer, size: THREE.Vector2) {
      if (!texture || size.x !== width || size.y !== height) {
        texture?.dispose();
        width = size.x;
        height = size.y;
        texture = new THREE.FramebufferTexture(width, height);
        material.map = texture;
        material.needsUpdate = true;
      }
      renderer.copyFramebufferToTexture(texture);
      kept = true;
    },
    /** Réaffiche l'image gardée : un quad plein écran, une commande, rien de la scène. */
    present(renderer: THREE.WebGLRenderer) {
      renderer.render(scene, camera);
    },
  };
}
