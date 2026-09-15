import { PAGE_DECODE_PROTOCOL, pageDecodeFailureCode } from '../sdk-core/index.ts';
import type { DecodedGeometryPage } from './geometryPage.ts';
import { sha256Hex } from './sha256Hex.ts';
import type {
  PageDecodeAnswer,
  PageDecodeGeometryPayload,
  PageDecodeRequest,
} from '../sdk-core/index.ts';

/**
 * Le décodage de page, chargé seulement quand une page arrive. Il tire la bibliothèque de
 * décompression, nommée par un spécificateur nu ; or un worker dédié n'hérite pas de la carte
 * d'imports du document, si bien qu'un hôte qui sert ses modules tels quels ne saurait pas la
 * résoudre. En la laissant hors du graphe statique, le worker démarre partout, le contrôle
 * d'intégrité part hors du fil chez tous les hôtes, et seul le décodage d'attributs retombe sur le
 * repli là où la dépendance reste introuvable. La promesse est gardée : un seul chargement.
 */
let geometrie: Promise<typeof import('./geometryPage.ts')> | undefined;

/**
 * Le travail lui-même, écrit une seule fois. Le worker l'exécute, et le repli synchrone exécute
 * exactement la même fonction sur le fil principal : c'est ce partage — et non une relecture des
 * deux codes — qui garantit le même octet de sortie des deux côtés du fil.
 */
export async function runPageDecodeTask(
  request: PageDecodeRequest,
): Promise<{ answer: PageDecodeAnswer; transfer: ArrayBuffer[] }> {
  const started = performance.now();
  try {
    if (request.op === 'verify') {
      const sha256 = await sha256Hex(request.source);
      return {
        answer: {
          protocol: PAGE_DECODE_PROTOCOL,
          id: request.id,
          ok: true,
          sha256,
          source: request.source,
          decoded: null,
          taskMs: performance.now() - started,
        },
        transfer: [request.source],
      };
    }
    const { decodeGeometryPage } = await (geometrie ??= import('./geometryPage.ts'));
    const decoded = await decodeGeometryPage(
      new Uint8Array(request.source),
      request.maxDecodedBytes,
    );
    const payload = geometryPayload(decoded);
    return {
      answer: {
        protocol: PAGE_DECODE_PROTOCOL,
        id: request.id,
        ok: true,
        sha256: null,
        source: null,
        decoded: payload,
        taskMs: performance.now() - started,
      },
      transfer: [payload.indices, ...payload.attributes],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      answer: {
        protocol: PAGE_DECODE_PROTOCOL,
        id: request.id,
        ok: false,
        code: pageDecodeFailureCode(message),
        message,
      },
      transfer: [],
    };
  }
}

/**
 * Les tampons d'une page décodée, prêts à être transférés. Chaque tableau typé que le décodage vient
 * d'allouer possède son tampon en entier, du premier au dernier octet : `buffer` est donc exactement
 * la valeur, sans décalage ni reste, et le transfert ne perd ni ne recopie rien.
 */
function geometryPayload(page: DecodedGeometryPage): PageDecodeGeometryPayload {
  const names = Object.keys(page.attributes);
  return {
    indices: page.indices.buffer as ArrayBuffer,
    names,
    attributes: names.map((name) => page.attributes[name].buffer as ArrayBuffer),
    vertexCount: page.vertexCount,
    flags: page.flags,
    decodedBytes: page.decodedBytes,
  };
}

/** La page décodée reconstruite depuis ses tampons. `names` rend l'ordre d'écriture du décodage, si
 *  bien que le `Record` d'attributs retrouve ses champs dans le même ordre qu'un décodage sur place. */
export function restorePageDecode(payload: PageDecodeGeometryPayload): DecodedGeometryPage {
  const attributes: Record<string, Float32Array> = {};
  for (let i = 0; i < payload.names.length; i++)
    attributes[payload.names[i]] = new Float32Array(payload.attributes[i]);
  return {
    indices: new Uint32Array(payload.indices),
    attributes,
    vertexCount: payload.vertexCount,
    flags: payload.flags,
    decodedBytes: payload.decodedBytes,
  };
}
