import { TILE_BYTES } from './textureTiles.ts';
import type { TextureLevelReader } from './textureLevelReader.ts';
import {
  createWebgpuTileAtlas,
  type TileTexture,
  type WebgpuTileAtlas,
} from './webgpuTileAtlas.ts';
import { createWebgpuTileFeedback } from './webgpuTileFeedback.ts';
import { createTileSources } from './webgpuTileSources.ts';
import { createWebgpuTileReduce } from './webgpuTileReduce.ts';
import type { TileKey } from './webgpuTilePageTable.ts';
import { createTileCounters } from './webgpuTileCounters.ts';

type Request = { atlas: WebgpuTileAtlas; key: TileKey; weight: number };

/**
 * Le diffuseur de tuiles : ce que l'image a demandé devient résident, sous un budget d'octets par
 * image, la tuile la plus regardée d'abord. Les compteurs du retour d'image nomment les tuiles ; le
 * diffuseur touche celles qui résident, lit les niveaux cuits des autres et les copie dès que
 * leurs octets sont là, en cédant les places les moins regardées quand le pool est plein.
 *
 * Rien n'attend ici : une tuile dont le niveau se lit encore repassera au retour suivant. Seule la
 * barrière (`flush`) demande la convergence — tous les pixels parlent, le budget est levé, et la
 * boucle se rejoue jusqu'à ce qu'aucune tuile demandée ne manque.
 */
export function createWebgpuTileStreamer(options: {
  device: GPUDevice;
  color: TileTexture[];
  data: TileTexture[];
  layersPerAtlas: number;
  /** Octets de tuiles admis par image hors barrière. */
  budgetBytes: number;
  readLevel?: TextureLevelReader;
  onFailure: (phase: string, error: unknown) => void;
  /** Des tuiles de couleur viennent d'arriver ou de partir : ce que l'ombre d'un feuillage découpé
   *  doit suivre. */
  onColorChanged: () => void;
}) {
  const { device } = options;
  const color = createWebgpuTileAtlas(device, {
    kind: 'color',
    format: 'rgba8unorm-srgb',
    layers: options.layersPerAtlas,
    feedbackOffset: 0,
    textures: options.color,
  });
  const data = createWebgpuTileAtlas(device, {
    kind: 'data',
    format: 'rgba8unorm',
    layers: options.layersPerAtlas,
    feedbackOffset: color.pages.entries,
    textures: options.data,
  });
  const feedback = createWebgpuTileFeedback(device, color.pages.entries + data.pages.entries);
  const reduce = createWebgpuTileReduce(device);
  const counters = createTileCounters();
  const sources = createTileSources({
    device,
    readLevel: options.readLevel,
    counters,
    onFailure: options.onFailure,
  });
  /** Les tuiles que le dernier retour d'image nomme, celles qui résident touchées au passage. */
  const requests = (frame: number) => {
    const counts = feedback.take();
    const out: Request[] = [];
    if (!counts) return out;
    let requested = 0,
      atLevel = 0,
      gap = 0;
    for (let index = 0; index < counts.length; index++) {
      const weight = counts[index];
      if (!weight) continue;
      const atlas = index < color.pages.entries ? color : data;
      const key = atlas.pages.tileOf(index);
      requested++;
      const served = atlas.servedLevel(key) - key.level;
      if (served === 0) atLevel++;
      gap += served;
      if (!atlas.touch(key, frame)) out.push({ atlas, key, weight });
    }
    counters.requested = requested;
    counters.atLevel = atLevel;
    counters.missingAverage = requested ? gap / requested : 0;
    return out.sort((a, b) => b.weight - a.weight);
  };
  return {
    color,
    data,
    feedback,
    counters,
    /** Épingle toutes les queues : ce que l'image montre avant qu'aucune tuile ne soit demandée. */
    prepare() {
      for (const atlas of [color, data])
        atlas.pinTails(device.queue, (slot, place) => sources.tail(atlas, slot, place));
      color.flush(device);
      data.flush(device);
    },
    /**
     * Une passe : les tuiles demandées, servies dans l'ordre de leur poids sous le budget d'octets ;
     * `unbounded` lève le budget. Rend ce qui a été servi et ce qui manque encore.
     */
    pump(frame: number, unbounded = false) {
      const started = performance.now();
      let served = 0,
        missing = 0,
        bytes = 0,
        colorServed = false,
        encoder: GPUCommandEncoder | undefined;
      const open = () => (encoder ??= device.createCommandEncoder({ label: 'WG texture tiles' }));
      const wanted = requests(frame);
      counters.worked = wanted.length > 0;
      for (const request of wanted) {
        if (!unbounded && bytes >= options.budgetBytes) {
          missing++;
          continue;
        }
        let done = false;
        try {
          done = sources.serve(request.atlas, request.key, frame, open);
        } catch (error) {
          options.onFailure('texture-tile-failed', error);
        }
        if (!done) {
          missing++;
          continue;
        }
        served++;
        bytes += TILE_BYTES;
        if (request.atlas === color) colorServed = true;
      }
      if (encoder) device.queue.submit([encoder.finish()]);
      sources.endPass();
      color.flush(device);
      data.flush(device);
      counters.served += served;
      counters.pending = missing;
      counters.bytesLastFrame = bytes;
      counters.lastMs = performance.now() - started;
      if (colorServed) options.onColorChanged();
      return { served, missing };
    },
    /** Le retour d'une image part avec elle : la cible où ses pixels ont posé leurs demandes — quand
     *  une passe l'a écrite — est réduite en compteurs pour la phase, copiés vers leur lecture puis
     *  remis à zéro. */
    publishRequests(
      encoder: GPUCommandEncoder,
      target: GPUTextureView | undefined,
      size: [number, number],
      every: boolean,
    ) {
      if (target) reduce?.encode(encoder, target, feedback.buffer, size, feedback.phaseWord(every));
      feedback.encode(encoder);
    },
    /** Faux sur un appareil sans étage de calcul : aucun pixel ne demande de tuile. */
    get requestReduce() {
      return reduce !== undefined;
    },
    metrics: () => counters.metrics([color, data], sources.levels),
    /** Vrai tant qu'un niveau cuit se lit : une tuile manquante peut encore arriver. */
    get reading() {
      return (sources.levels?.inFlight ?? 0) > 0;
    },
    /** Tenue quand le retour d'image en vol est revenu et que les lectures de niveaux ont abouti. */
    settled: () => Promise.all([feedback.settled(), sources.settled()]).then(() => undefined),
    destroy() {
      sources.destroy();
      reduce?.destroy();
      feedback.destroy();
      color.destroy();
      data.destroy();
    },
  };
}

export type WebgpuTileStreamer = ReturnType<typeof createWebgpuTileStreamer>;
