import test from 'node:test';
import assert from 'node:assert/strict';
import { drawShader } from './gpuDrawShader.ts';
import { slotCount } from './gpuDraw.ts';
import { prefixParallel, prefixSerial } from './bench/oracles/gpuDrawPrefixOracle.ts';

// D3 : le préfixe du tirage indirect est passé du parcours en série (un fil) à la répartition des
// slots sur les soixante-quatre fils d'un groupe de travail. Ce fichier épingle les deux moitiés de
// la preuve : le noyau expédié a bien la forme que l'oracle décrit, et les deux noyaux de l'oracle
// rendent le même résultat sur des entrées tirées au hasard, y compris celles que les tests écrits
// à la main ne couvrent pas — slots vides épars, groupes très nombreux, débordement.

const prefixKernel = (shader: string) => {
  const start = shader.indexOf('fn prefixGroups');
  const end = shader.indexOf('fn scatterGroups');
  assert.ok(start >= 0 && end > start, 'le noyau de préfixe est présent, avant l’éparpillage');
  return shader.slice(start, end);
};

test('le noyau de préfixe expédié répartit les slots sur les 64 fils, avec une barrière entre ses deux phases', () => {
  for (const k of [1, 2, 3, 5]) {
    const shader = drawShader(k);
    const slots = slotCount(k);
    assert.match(
      shader,
      new RegExp(`var<workgroup> slotTotals:array<u32,${slots}>;`),
      'les totaux par slot vivent en mémoire de groupe de travail, dimensionnés aux slots ouverts',
    );
    assert.match(
      shader,
      /@compute @workgroup_size\(64\)\s*fn prefixGroups\(@builtin\(local_invocation_id\) lid:vec3u\)/,
      'le préfixe tourne sur soixante-quatre fils et lit son rang de fil',
    );
    const kernel = prefixKernel(shader);
    assert.doesNotMatch(kernel, /slotStart/, 'plus de curseur unique poussé de slot en slot');
    assert.equal(
      (kernel.match(/workgroupBarrier\(\);/g) ?? []).length,
      1,
      'une barrière, et une seule, sépare les totaux du calcul des décalages',
    );
    // Chaque fil ne touche que les slots de son rang modulo 64, et resomme les totaux de ceux qui le
    // précèdent : c'est ce qui rend le résultat identique au parcours en série.
    const stride = new RegExp(`for\\(var slot=lane;slot<${slots}u;slot\\+=64u\\)`, 'g');
    assert.equal(
      (kernel.match(stride) ?? []).length,
      4,
      'les quatre boucles du noyau — mise à zéro, débordement, totaux, décalages — parcourent les slots par pas de 64',
    );
    assert.match(
      kernel,
      /for\(var before=0u;before<slot;before\+\+\)\{cursor=cursor\+slotTotals\[before\];\}/,
      'le curseur d’un slot est la somme des totaux des slots qui le précèdent',
    );
  }
});

test('sur mille entrées tirées au hasard, les deux noyaux rendent les mêmes totaux et les mêmes décalages', () => {
  let seed = 20260915;
  const rand = (bound: number) => ((seed = (seed * 1103515245 + 12345) >>> 0) % bound) as number;
  for (let trial = 0; trial < 1000; trial++) {
    const slots = slotCount(1 + rand(4));
    const groupCount = 1 + rand(64);
    const slotUsed = new Uint32Array(slots);
    for (let s = 0; s < slots; s++) slotUsed[s] = rand(3) === 0 ? 0 : 1;
    const groupCounts = new Uint32Array(groupCount * slots);
    for (let g = 0; g < groupCount; g++)
      for (let s = 0; s < slots; s++) groupCounts[g * slots + s] = slotUsed[s] ? rand(97) : 0;
    const overflow = trial % 97 === 0;
    const serial = prefixSerial(overflow, slotUsed, groupCounts, groupCount, slots);
    const parallel = prefixParallel(overflow, slotUsed, groupCounts, groupCount, slots);
    assert.deepEqual([...parallel.totals], [...serial.totals], `totaux, tirage ${trial}`);
    assert.deepEqual([...parallel.offsets], [...serial.offsets], `décalages, tirage ${trial}`);
  }
});
