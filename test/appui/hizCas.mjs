// Les cas de la sonde d'occultation Hi-Z : une pyramide empaquetée par le moteur lui-même, et le
// verdict que chacune doit produire. Le module est séparé de la preuve pour que celle-ci tienne
// sous sa limite de lignes ; il n'est jamais lancé seul.
import { packHizPyramid } from '../../packages/sdk-browser/gpuHiz.ts';
import { DEPTH_CLEAR } from '../../packages/sdk-browser/depthConvention.ts';

export const width = 33,
  height = 19;

// Profondeur INVERSÉE (`depthConvention.ts`) : 1 est le plan proche, `DEPTH_CLEAR` le lointain, et
// la réduction Hi-Z garde le plus lointain d'un carré, donc le MINIMUM. Un occulteur à 0,6 remplit
// l'écran ; la boîte testée porte son point le plus proche à 0,3, donc DERRIÈRE lui.
const OCCLUDER_DEPTH = 0.6;
export const BOX_NEAREST = 0.3;

// Le verdict d'une ligne vaut trois valeurs : 1 rejetée, 2 dessinée, 0 jamais écrit par ce noyau.
const REJETEE = 1,
  DESSINEE = 2;

const makeCase = (hole) => {
  const depth = Array.from({ length: height }, () => Array(width).fill(OCCLUDER_DEPTH));
  // Un trou de FOND : au lointain, donc rien ne peut être rejeté derrière lui.
  if (hole) depth[18][32] = DEPTH_CLEAR;
  const packed = packHizPyramid(depth);
  return {
    name: hole ? 'edge background hole' : 'fully covered',
    data: [...packed.data],
    size: packed.data.byteLength,
    expected: hole ? DESSINEE : REJETEE,
  };
};

export const cases = [
  makeCase(false),
  makeCase(true),
  // Une ligne que la pyramide ne peut pas juger reste DESSINÉE, elle n'est jamais rejetée.
  { ...makeCase(false), name: 'near-plane crossing', clipsNear: true, expected: DESSINEE },
];
