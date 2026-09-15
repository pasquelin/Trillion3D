import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

/** Un élément, indenté sous sa clé. Chaque élément est petit ; c'est le rapport entier qui ne l'est
 *  pas, et c'est lui qu'on ne construit jamais en mémoire. */
function indented(value, pad) {
  return JSON.stringify(value ?? null, null, 2).replaceAll('\n', '\n' + pad);
}

/**
 * Écrit le rapport de capture au fil de l'eau. `JSON.stringify(result, null, 2)` allouait d'un coup
 * une chaîne de la taille de tout le rapport — six cents images d'échantillons, la trace complète
 * des diagnostics et l'état des dix captures — et épuisait le tas de Node juste après la dernière
 * capture, donc au pire moment : le rapport était perdu alors que le travail était fait. Ici chaque
 * tableau part élément par élément, avec la contre-pression du flux, et rien de la taille du tout
 * n'existe jamais. Le fichier produit est le même JSON indenté qu'avant.
 */
export async function writeCaptureReport(path, report) {
  const stream = createWriteStream(path);
  const push = async (chunk) => {
    if (!stream.write(chunk)) await once(stream, 'drain');
  };
  const keys = Object.keys(report).filter((key) => report[key] !== undefined);
  await push('{\n');
  for (let k = 0; k < keys.length; k++) {
    const value = report[keys[k]];
    await push('  ' + JSON.stringify(keys[k]) + ': ');
    if (Array.isArray(value)) {
      await push('[');
      for (let i = 0; i < value.length; i++)
        await push((i ? ',' : '') + '\n    ' + indented(value[i], '    '));
      await push(value.length ? '\n  ]' : ']');
    } else await push(indented(value, '  '));
    await push(k < keys.length - 1 ? ',\n' : '\n');
  }
  await push('}\n');
  stream.end();
  await once(stream, 'close');
}

/**
 * Vide par tranches un des grands tableaux que la page a gardés (`events`, `samples`). Rendus d'un
 * coup par `page.evaluate`, ils passaient tout entiers par le sérialiseur du pilote, qui en
 * construit plusieurs copies intermédiaires : le tas de Node y passait juste après la dixième
 * capture. Tranche par tranche, rien de plus grand qu'une tranche n'existe à la fois côté page.
 */
export async function drainPageArray(page, name, slice = 2000) {
  const drained = [];
  for (;;) {
    const part = await page.evaluate(
      ([key, size]) => window.__wgCaptureDrain[key].splice(0, size),
      [name, slice],
    );
    if (!part.length) return drained;
    for (const entry of part) drained.push(entry);
  }
}
