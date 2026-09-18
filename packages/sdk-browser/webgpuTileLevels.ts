import type { TextureLevelReader } from './textureLevelReader.ts';

/**
 * Les niveaux cuits décodés, tenus le temps d'en découper les tuiles.
 *
 * Une tuile se lit dans le niveau entier du cache, décodé par le navigateur ; les tuiles voisines
 * d'un même niveau arrivent en général dans les mêmes images, et redécoder un niveau 2048² pour
 * chacune coûterait plus que le transfert. Les niveaux décodés restent donc ici, sous un budget
 * d'octets hôte fixe, la moins récemment lue partant la première. C'est la seule mémoire hôte de la
 * chaîne, et elle ne dépend pas de la scène.
 *
 * Une lecture en vol n'est jamais doublée, et un échec est rendu à l'appelant, jamais retenté en
 * silence : la tuile restera servie par son niveau grossier, et le diagnostic le dira.
 */
export type LevelKey = { sha256: string; atlas: number; level: number };

export type WebgpuTileLevels = {
  /** Le niveau décodé s'il est là, en le marquant lu ; sinon `undefined`, sans rien lancer. */
  get(key: LevelKey, frame: number): ImageBitmap | undefined;
  /** Lance la lecture si elle n'est ni là ni en vol. */
  request(key: LevelKey, frame: number): void;
  readonly inFlight: number;
  readonly fetched: number;
  readonly bytes: number;
  /** Tenue quand toutes les lectures en vol ont abouti ou échoué. */
  settled(): Promise<void>;
  destroy(): void;
};

const keyOf = ({ sha256, atlas, level }: LevelKey) => `${sha256}/${atlas}/${level}`;

export function createWebgpuTileLevels(options: {
  read: TextureLevelReader;
  budgetBytes: number;
  onFailure: (key: LevelKey, error: unknown) => void;
}): WebgpuTileLevels {
  const held = new Map<string, { bitmap: ImageBitmap; bytes: number; lastUse: number }>();
  const pending = new Map<string, Promise<void>>();
  let bytes = 0,
    fetched = 0;
  const drop = (id: string) => {
    const entry = held.get(id);
    if (!entry) return;
    held.delete(id);
    bytes -= entry.bytes;
    entry.bitmap.close();
  };
  /** Fait de la place pour `needed` octets : la moins récemment lue part la première. */
  const makeRoom = (needed: number) => {
    while (bytes + needed > options.budgetBytes && held.size) {
      let oldest: string | undefined,
        oldestUse = Infinity;
      for (const [id, entry] of held)
        if (entry.lastUse < oldestUse) {
          oldestUse = entry.lastUse;
          oldest = id;
        }
      if (oldest !== undefined) drop(oldest);
    }
  };
  return {
    get(key, frame) {
      const entry = held.get(keyOf(key));
      if (!entry) return undefined;
      entry.lastUse = frame;
      return entry.bitmap;
    },
    request(key, frame) {
      const id = keyOf(key);
      if (held.has(id) || pending.has(id)) return;
      const read = options
        .read(key.sha256, key.atlas, key.level)
        .then((bitmap) => {
          fetched++;
          const size = bitmap.width * bitmap.height * 4;
          makeRoom(size);
          held.set(id, { bitmap, bytes: size, lastUse: frame });
          bytes += size;
        })
        .catch((error: unknown) => options.onFailure(key, error))
        .finally(() => pending.delete(id));
      pending.set(id, read);
    },
    get inFlight() {
      return pending.size;
    },
    get fetched() {
      return fetched;
    },
    get bytes() {
      return bytes;
    },
    settled: () => Promise.all(pending.values()).then(() => undefined),
    destroy() {
      for (const id of [...held.keys()]) drop(id);
    },
  };
}
