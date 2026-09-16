import { PAGE_DECODE_PROTOCOL, pageDecodeFailureCode } from '../sdk-core/index.ts';
import type { DecodedGeometryPage } from './geometryPage.ts';
import { sha256Hex } from './sha256Hex.ts';
import type {
  PageDecodeAnswer,
  PageDecodeGeometryPayload,
  PageDecodeRequest,
} from '../sdk-core/index.ts';

/**
 * Le décodeur de pages, choisi une seule fois et gardé. D'abord le module compilé en WebAssembly :
 * il ne nomme aucune dépendance, donc un worker dédié le charge même chez un hôte qui sert ses
 * modules tels quels, sans carte d'imports ni empaqueteur. S'il ne s'instancie pas — pas de
 * `WebAssembly`, pas de SIMD, ressource absente — le décodeur JavaScript prend sa place ; celui-là
 * tire la bibliothèque de décompression par un spécificateur nu, et peut donc, lui, être
 * introuvable. Quand aucun des deux ne se charge, la tâche le dit et l'appelant refait le travail
 * chez lui.
 *
 * Les deux rendent les mêmes tampons et les mêmes refus : le banc H2b le prouve valeur par valeur.
 */
type Decodeur = {
  decode: (data: Uint8Array, maxDecodedBytes: number) => Promise<DecodedGeometryPage>;
  wasm: boolean;
};
let decodeur: Promise<Decodeur> | undefined;

async function chargeDecodeur(): Promise<Decodeur> {
  const codec = await import('./geometryPageWasm.ts');
  if (await codec.prepareSdkWasm())
    return { decode: codec.decodeGeometryPageWasm, wasm: true };
  const js = await import('./geometryPage.ts');
  return { decode: js.decodeGeometryPage, wasm: false };
}

/** Aucun décodeur de ce côté du fil : l'appelant refera le travail chez lui, sans rien rejeter. */
function indisponible(id: number, cause: unknown) {
  return {
    answer: {
      protocol: PAGE_DECODE_PROTOCOL,
      id,
      ok: false as const,
      code: 'PAGE_DECODE_UNAVAILABLE' as const,
      message: cause instanceof Error ? cause.message : String(cause),
    },
    transfer: [] as ArrayBuffer[],
  };
}

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
          wasm: false,
          taskMs: performance.now() - started,
        },
        transfer: [request.source],
      };
    }
    let choisi: Decodeur;
    try {
      choisi = await (decodeur ??= chargeDecodeur());
    } catch (cause) {
      decodeur = undefined;
      return indisponible(request.id, cause);
    }
    const decoded = await choisi.decode(new Uint8Array(request.source), request.maxDecodedBytes);
    const payload = geometryPayload(decoded);
    return {
      answer: {
        protocol: PAGE_DECODE_PROTOCOL,
        id: request.id,
        ok: true,
        sha256: null,
        source: null,
        decoded: payload,
        wasm: choisi.wasm,
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
