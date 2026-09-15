import { decodeGeometryPage, type DecodedGeometryPage } from './geometryPage.ts';

/**
 * Chargeur du décodeur de pages compilé en WebAssembly (`packages/page-codec-wasm`).
 *
 * Le module n'importe rien et n'exporte que sa mémoire linéaire et quatre fonctions : la page
 * compressée est écrite dans cette mémoire, le décodeur y dépose ses tampons et rend leurs offsets.
 * Rien n'est recopié entre les deux. Les tampons rendus à l'appelant, eux, sont bien des copies :
 * ils survivent au `page_release` et peuvent être transférés à un autre fil.
 *
 * Si `WebAssembly` manque ou si l'instanciation échoue, le décodeur JavaScript reprend la main —
 * mêmes tampons, mêmes refus, seulement plus lentement.
 */

/** Les attributs facultatifs, dans l'ordre et sous les noms du décodeur JavaScript. */
const OPTIONNELS: ReadonlyArray<readonly [string, number]> = [
  ['normal', 3],
  ['uv', 2],
  ['tangent', 4],
  ['uv2', 2],
  ['color', 4],
];
/** Les causes de refus du décodeur Rust, à l'index de leur code. */
const CAUSES = [
  '',
  'GEOMETRY_PAGE_HEADER',
  'GEOMETRY_PAGE_VERSION',
  'GEOMETRY_PAGE_BOUNDS',
  'GEOMETRY_PAGE_INDEX',
  'GEOMETRY_PAGE_NONFINITE',
  'GEOMETRY_PAGE_MESHOPT',
];
const MOTS = 12;

type Codec = {
  memory: WebAssembly.Memory;
  page_alloc(len: number): number;
  page_free(offset: number, len: number): void;
  page_decode(offset: number, len: number, maxDecodedBytes: number): number;
  page_release(offset: number): void;
};
type SourceWasm = BufferSource | (() => Promise<BufferSource>);

let attente: Promise<Codec | null> | null = null;

/** La ressource livrée à côté du module : le navigateur la prend par son URL, pas par le disque. */
async function ressource(): Promise<BufferSource> {
  const reponse = await fetch(new URL('./pageCodec.wasm', import.meta.url));
  if (!reponse.ok) throw new Error('GEOMETRY_PAGE_WASM');
  return await reponse.arrayBuffer();
}

async function instancie(source: SourceWasm): Promise<Codec | null> {
  try {
    if (typeof WebAssembly === 'undefined') return null;
    const octets = typeof source === 'function' ? await source() : source;
    const { instance } = await WebAssembly.instantiate(octets, {});
    return instance.exports as unknown as Codec;
  } catch {
    return null;
  }
}

/**
 * Instancie le module une fois pour toutes et dit s'il est disponible. L'hôte peut fournir les
 * octets — c'est ce que fait Node, qui ne sait pas suivre une URL de fichier avec `fetch`.
 */
export function prepareGeometryPageWasm(source: SourceWasm = ressource): Promise<Codec | null> {
  attente ??= instancie(source);
  return attente;
}

/** Les tampons du bloc de résultat, copiés hors de la mémoire linéaire avant qu'elle ne bouge. */
function copie(codec: Codec, bloc: number): DecodedGeometryPage {
  const mots = new Uint32Array(codec.memory.buffer, bloc, MOTS);
  if (mots[0]) throw new Error(CAUSES[mots[0]] ?? 'GEOMETRY_PAGE_BOUNDS');
  const vertexCount = mots[1],
    indexCount = mots[2],
    flags = mots[3],
    decodedBytes = mots[4];
  const indices = new Uint32Array(codec.memory.buffer, mots[5], indexCount).slice();
  const attributes: Record<string, Float32Array> = {
    position: new Float32Array(codec.memory.buffer, mots[6], vertexCount * 3).slice(),
  };
  for (let i = 0; i < OPTIONNELS.length; i++) {
    const offset = mots[7 + i];
    if (offset)
      attributes[OPTIONNELS[i][0]] = new Float32Array(
        codec.memory.buffer,
        offset,
        vertexCount * OPTIONNELS[i][1],
      ).slice();
  }
  return { indices, attributes, vertexCount, flags, decodedBytes };
}

/** Même signature, mêmes tampons et mêmes refus que `decodeGeometryPage`. */
export async function decodeGeometryPageWasm(
  data: Uint8Array,
  maxDecodedBytes = 16 * 1024 * 1024,
): Promise<DecodedGeometryPage> {
  const codec = await prepareGeometryPageWasm();
  if (!codec) return decodeGeometryPage(data, maxDecodedBytes);
  if (data.byteLength < 32) throw new Error('GEOMETRY_PAGE_HEADER');
  const entree = codec.page_alloc(data.byteLength);
  if (!entree) throw new Error('GEOMETRY_PAGE_BOUNDS');
  new Uint8Array(codec.memory.buffer, entree, data.byteLength).set(data);
  const bloc = codec.page_decode(entree, data.byteLength, maxDecodedBytes);
  codec.page_free(entree, data.byteLength);
  if (!bloc) throw new Error('GEOMETRY_PAGE_BOUNDS');
  try {
    return copie(codec, bloc);
  } finally {
    codec.page_release(bloc);
  }
}
