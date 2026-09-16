// Un moteur rendu par Three ne soumet rien lui-même : une image tenue redessinait la scène entière
// alors que le moteur venait de dire qu'elle ne pouvait pas changer. Elle est désormais réaffichée
// par un quad plein écran sur une copie explicite du tampon de dessin — le canevas ne garde rien
// d'une image à l'autre, `preserveDrawingBuffer` étant faux.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHeldFrame } from './explorerHeldFrame.ts';

/** Une doublure de rendu : ce qu'elle a copié du tampon de dessin, et ce qu'elle a dessiné. */
function rendu() {
  const copies: THREE.Texture[] = [];
  const dessins: THREE.Scene[] = [];
  // L'espace de sortie en vigueur au moment de chaque dessin : c'est lui qui dit si la commande
  // réencode ce qu'elle repose.
  const sorties: string[] = [];
  const renderer = {
    outputColorSpace: THREE.SRGBColorSpace,
    copyFramebufferToTexture: (texture: THREE.Texture) => copies.push(texture),
    render: (scene: THREE.Scene) => {
      dessins.push(scene);
      sorties.push(renderer.outputColorSpace);
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, copies, dessins, sorties };
}

const taille = (x: number, y: number) => new THREE.Vector2(x, y);

test('rien n’est gardé tant qu’aucune image complète n’a été copiée', () => {
  const held = createHeldFrame();
  assert.equal(held.holds(taille(1280, 720)), false, 'la première image doit être dessinée');
});

test('l’image gardée est réaffichée par une seule commande, et rien de la scène', () => {
  const { renderer, copies, dessins } = rendu();
  const held = createHeldFrame();
  held.keep(renderer, taille(1280, 720));
  assert.equal(copies.length, 1, 'l’image complète est copiée une fois');
  assert.equal(held.holds(taille(1280, 720)), true);
  held.present(renderer);
  assert.equal(dessins.length, 1, 'une commande, pas une scène reparcourue');
  held.present(renderer);
  assert.equal(dessins.length, 2, 'chaque image tenue coûte exactement une commande');
  assert.equal(copies.length, 1, 'une image tenue ne recopie rien : elle relit ce qu’elle a posé');
  // Ce qui est dessiné est le quad de l'image gardée, jamais la scène du moteur.
  assert.equal(dessins[0], dessins[1]);
  assert.equal(dessins[0].children.length, 1, 'un seul objet : le quad plein écran');
});

test('la présentation ne retouche pas la couleur : la sortie est déjà encodée', () => {
  const { renderer, copies, dessins, sorties } = rendu();
  const held = createHeldFrame();
  held.keep(renderer, taille(1280, 720));
  held.present(renderer);
  const texture = copies[0]!;
  const materiau = (dessins[0]!.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
  // La copie reste un relevé brut : une texture sRGB ne peut pas recevoir le tampon de dessin.
  assert.equal(texture.colorSpace, THREE.NoColorSpace);
  assert.equal(materiau.toneMapped, false, 'la correction de tonalité a déjà été appliquée');
  assert.equal(materiau.map, texture, 'le quad présente bien la copie de l’image complète');
  // La commande qui repose la copie ne la réencode pas, et la chaîne du moteur est rendue ensuite.
  assert.deepEqual(sorties, [THREE.LinearSRGBColorSpace]);
  assert.equal(renderer.outputColorSpace, THREE.SRGBColorSpace);
});

test('un redimensionnement retire l’image gardée : elle ne décrit plus la cible', () => {
  const { renderer } = rendu();
  const held = createHeldFrame();
  held.keep(renderer, taille(1280, 720));
  assert.equal(held.holds(taille(640, 360)), false, 'une autre taille n’est pas cette image');
  held.keep(renderer, taille(640, 360));
  assert.equal(held.holds(taille(640, 360)), true);
  assert.equal(held.holds(taille(1280, 720)), false);
});
