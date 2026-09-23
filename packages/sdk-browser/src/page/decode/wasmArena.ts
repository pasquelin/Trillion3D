import type { SdkWasm } from './geometryPageWasm.ts';

/**
 * Shared buffer: blocks reserved in the linear memory of the SDK WebAssembly module, on which
 * JavaScript lays its typed views. Both sides read and write the same bytes; nothing is copied
 * on the compute path.
 *
 * GROWTH, HELD BY A GENERATION. `WebAssembly.Memory.grow` replaces the `ArrayBuffer` and detaches
 * every view already built: a stale view reads zero without signalling anything. Any module
 * allocation can trigger it — a page decode folded onto the main thread as much as a second
 * reservation — so forbidding it elsewhere was not enough. Here `blocs()` compares the module's
 * current buffer to the one that carried the views and REBUILDS them all when it has changed,
 * counting one more generation. The bytes themselves survive: `grow` copies the memory, so a
 * block keeps its offset and its contents. We never copy anything ourselves.
 *
 * A caller therefore does not keep a view from one frame to the next: it asks again through
 * `blocs()`, which costs only a buffer comparison as long as memory has not moved. Offsets are
 * stable for the whole life of the buffer — they are what the module functions receive.
 *
 * A block carries its own type: `Float64Array` for matrices, boxes, spheres and errors,
 * `Float32Array` for what already arrives in single precision, `Uint32Array` for flags, ids and
 * counters. A variable-size output is declared as two blocks — a one-word counter, a list at its
 * maximum size — and is reread with `liste()`.
 */

/** Version of the buffer and lot contract. A module that yields anything else is refused. */
export const WASM_ARENA_CONTRACT = 1;

/** Alignment of each block, in bytes: that of an `f64`, which also covers 32 bits. */
const ALIGNEMENT = 8;

type ArenaType = 'f64' | 'f32' | 'u32';
type ArenaView = Float64Array | Float32Array | Uint32Array;

const TAILLES: Record<ArenaType, number> = { f64: 8, f32: 4, u32: 4 };
const CONSTRUCTEURS = {
  f64: Float64Array,
  f32: Float32Array,
  u32: Uint32Array,
} as const;

export interface ArenaDemande {
  readonly type: ArenaType;
  /** Number of elements in the block. For a variable-size output, its maximum. */
  readonly longueur: number;
  /** Stride of the subviews, in elements; absent when the block does not need them. */
  readonly pas?: number;
}

export interface ArenaBloc {
  readonly type: ArenaType;
  /** Offset in BYTES in linear memory: what the module functions expect. */
  readonly offset: number;
  readonly vue: ArenaView;
  /** Subviews of `pas` elements, or `null` when the request did not ask for them. */
  readonly vues: readonly ArenaView[] | null;
}

export interface Arena {
  /**
   * Blocks of the buffer, their views rebuilt if the module memory has grown since the last
   * call. Empty once the buffer is released: no view still points at memory of ours.
   */
  blocs(): readonly ArenaBloc[];
  /** Rebuilds undergone since reservation. Zero says memory has never moved. */
  generation(): number;
  readonly octets: number;
  /** First `n` elements of a block: the useful part of a variable-size output. */
  liste(index: number, n: number): ArenaView;
  libere(): void;
}

const aligne = (octets: number) => Math.ceil(octets / ALIGNEMENT) * ALIGNEMENT;

/** A block and its subviews, whichever memory carries it. */
function bloc(demande: ArenaDemande, offset: number, vue: ArenaView): ArenaBloc {
  const pas = demande.pas ?? 0;
  let vues: ArenaView[] | null = null;
  if (pas > 0) {
    const compte = Math.floor(demande.longueur / pas);
    vues = new Array(compte);
    for (let i = 0; i < compte; i++) vues[i] = vue.subarray(i * pas, i * pas + pas);
  }
  return { type: demande.type, offset, vue, vues };
}

/**
 * The same blocks outside the module memory: what the JavaScript path works on when
 * WebAssembly is missing. Their `offset` is zero — it names no linear memory.
 */
export function blocsJavaScript(demandes: readonly ArenaDemande[]): ArenaBloc[] {
  return demandes.map((demande) =>
    bloc(demande, 0, new CONSTRUCTEURS[demande.type](demande.longueur)),
  );
}

/**
 * Reserves the requested blocks in one allocation and returns their views. `null` when the
 * module refuses the size: the caller then stays on the JavaScript path, with its own arrays.
 */
export function reserveArena(wasm: SdkWasm, demandes: readonly ArenaDemande[]): Arena | null {
  const plan: { demande: ArenaDemande; debut: number }[] = [];
  let octets = 0;
  for (const demande of demandes) {
    plan.push({ demande, debut: octets });
    octets += aligne(demande.longueur * TAILLES[demande.type]);
  }
  const base = wasm.arena_alloc(octets);
  if (!base) return null;
  const construit = () =>
    plan.map(({ demande, debut }) =>
      bloc(
        demande,
        base + debut,
        new CONSTRUCTEURS[demande.type](wasm.memory.buffer, base + debut, demande.longueur),
      ),
    );
  let blocs = construit();
  let porteur = wasm.memory.buffer;
  let generation = 0;
  let rendu = false;
  /** Up-to-date blocks: one buffer comparison, and a rebuild only if it has changed. */
  const actuels = () => {
    if (!rendu && wasm.memory.buffer !== porteur) {
      porteur = wasm.memory.buffer;
      generation++;
      blocs = construit();
    }
    return blocs;
  };
  return {
    blocs: actuels,
    generation: () => generation,
    octets,
    liste: (index, n) => actuels()[index].vue.subarray(0, n),
    libere: () => {
      if (rendu) return;
      rendu = true;
      blocs = [];
      wasm.arena_free(base, octets);
    },
  };
}
