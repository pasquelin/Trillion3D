// les unités de couche coplanaire et le biais de profondeur qu'elles posent sur un f32.
import { biasedDepthBits, depthLayerUnits } from '../depthLayer.ts';
import { graine, mesure, rapport } from './socle.mjs';
import {
  referenceBiasedDepthBits,
  referenceDepthLayerUnits,
} from './oracles/couches-coplanaires.mjs';

const alea = graine(107);

// Un tiers des couches sont hostiles : hors bornes, non finies ou absentes. Le moteur les ramène
// toutes à zéro sans lever, et c'est ce que l'oracle vérifie sur les deux fonctions.
const HOSTILES = [-1, 16, NaN, Infinity, -Infinity, undefined, null];
const couche = () =>
  alea() < 0.3 ? HOSTILES[Math.floor(alea() * HOSTILES.length)] : Math.floor(alea() * 16);

// La sortie appartient au cas : le chronomètre n'encadre que les appels du moteur.
const couches = (nombre) => ({
  liste: Array.from({ length: nombre }, couche),
  sortie: new Float64Array(nombre),
});
const unites =
  (calcule) =>
  ({ liste, sortie }) => {
    for (let i = 0; i < liste.length; i++) sortie[i] = calcule(liste[i]);
    return sortie;
  };

const mesureUnites = await mesure({
  nom: 'unités de couche coplanaire',
  fichier: 'packages/sdk-core/depthLayer.ts',
  cas: [{ nom: '50 000 couches', taille: 50000, entree: couches(50000) }],
  calcul: unites(depthLayerUnits),
  attendu: unites(referenceDepthLayerUnits),
});

const paires = (nombre, fixe) => ({
  bits: Uint32Array.from({ length: nombre }, () => Math.floor(alea() * 0x3f800000)),
  layers: Array.from({ length: nombre }, fixe === undefined ? couche : () => fixe),
  sortie: new Float64Array(nombre),
});
const biaise =
  (calcule) =>
  ({ bits, layers, sortie }) => {
    for (let i = 0; i < bits.length; i++) sortie[i] = calcule(bits[i], layers[i]);
    return sortie;
  };

const mesureBits = await mesure({
  nom: 'bits de profondeur biaisés',
  fichier: 'packages/sdk-core/depthLayer.ts',
  cas: [
    { nom: '50 000 paires', taille: 50000, entree: paires(50000) },
    { nom: 'couche 0', taille: 10000, entree: paires(10000, 0) },
    {
      nom: 'bits saturés',
      taille: 2,
      entree: {
        bits: Uint32Array.of(0xffffffff, 0x3f800000),
        layers: [3, 15],
        sortie: new Float64Array(2),
      },
    },
  ],
  calcul: biaise(biasedDepthBits),
  attendu: biaise(referenceBiasedDepthBits),
});

rapport(
  'couches-coplanaires',
  [mesureUnites, mesureBits],
  'les unités de couche et les bits biaisés rendent les mêmes valeurs',
);
