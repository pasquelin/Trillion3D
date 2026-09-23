// Page side of the proof "the compute raster is watertight": the same scene rendered by the
// hardware raster, then by the compute raster under its two variants — the whole cut, then the
// small/large split — and the images compared pixel by pixel. Each builder tile is two
// triangles that share a diagonal, in two distinct clusters: that is the shared edge par
// excellence, under every slope. One more tile crosses the near plane, so that the clip
// and its shards are part of it.
//
// What is allowed between the two images: the silhouette band of the HARDWARE image alone —
// a pixel whose neighbourhood carries both coverage and background, where two fill
// rules can differ by one pixel. The band is read on an image the compute has not
// touched: a stray triangle in the middle of the background or a crack in the middle of a
// tile fall outside the band, and count.
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import { ouvrirAppareil } from '../probes/appareilWebgpu.ts';
import { VIEWPORT, cameraFace, libere, engine } from './preuveSceneCommune.ts';
import { image } from './preuveSceneImage.ts';
import { sceneCarreaux } from './rasterCalculScene.ts';
import type {
  BackendContext,
  BackendDiagnostic,
  RenderBackend,
} from '../../../packages/sdk-browser/src/backend/types.ts';
import type { DiagnosticGpuVariant } from '../../../packages/sdk-browser/src/diagnostic/gpuVariant.ts';

const estFond = (pixels: Uint8Array, i: number): boolean =>
  pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0;

/** Silhouette band of an image: a pixel whose 3×3 neighbourhood carries both background and
 *  coverage. Read on the hardware image alone. */
function bandeDeSilhouette(pixels: Uint8Array): Uint8Array {
  const [largeur, hauteur] = VIEWPORT,
    bande = new Uint8Array(largeur * hauteur);
  for (let y = 0; y < hauteur; y++)
    for (let x = 0; x < largeur; x++) {
      let fond = false,
        couvert = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= largeur || yy >= hauteur) continue;
          if (estFond(pixels, (yy * largeur + xx) * 4)) fond = true;
          else couvert = true;
        }
      bande[y * largeur + x] = fond && couvert ? 1 : 0;
    }
  return bande;
}

interface Comparaison {
  silhouettes: number;
  interieurs: number[][];
}

/** Pixels that differ: counted on the band, listed as `[x, y]` outside the band. */
function compare(materiel: Uint8Array, calcul: Uint8Array, bande: Uint8Array): Comparaison {
  let silhouettes = 0;
  const interieurs: number[][] = [];
  for (let p = 0; p < bande.length; p++) {
    const i = p * 4;
    if (
      materiel[i] === calcul[i] &&
      materiel[i + 1] === calcul[i + 1] &&
      materiel[i + 2] === calcul[i + 2]
    )
      continue;
    if (bande[p]) silhouettes++;
    else interieurs.push([p % VIEWPORT[0], Math.floor(p / VIEWPORT[0])]);
  }
  return { silhouettes, interieurs };
}

async function rendu(
  device: GPUDevice,
  onDiag: (e: BackendDiagnostic) => void,
  options: Partial<BackendContext>,
): Promise<{ pixels: Uint8Array; metriques: ReturnType<RenderBackend['metrics']> }> {
  const scene = sceneCarreaux();
  const { backend, canvas } = engine(webgpuPagesBackend, scene, device, onDiag, {
    maxResidentPages: 32,
    ...options,
  });
  try {
    await backend.prepare();
    const camera = cameraFace(0);
    // Two frames: the first places the occluder history, the second plays both halves.
    await image(backend, camera);
    const { pixels, metriques } = await image(backend, camera);
    return { pixels: pixels.slice(), metriques };
  } finally {
    libere(backend, canvas, scene);
  }
}

interface VarianteResult extends Comparaison {
  clusters: number | null | undefined;
}

interface ExecuterResult {
  indisponible?: string;
  erreur?: string;
  adaptateur?: string;
  couverts?: number;
  clusters?: number | null;
  variantes?: Record<string, VarianteResult>;
  evenements?: BackendDiagnostic[];
  erreurs?: string[];
}

export async function executer(): Promise<ExecuterResult> {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const evenements: BackendDiagnostic[] = [],
    onDiag = (e: BackendDiagnostic) => evenements.push(e);
  try {
    const materiel = await rendu(device, onDiag, {});
    const bande = bandeDeSilhouette(materiel.pixels);
    // The two ways of handing triangles to compute: the whole cut, or small ones only —
    // the reference split, where each triangle has exactly one of the two rasters.
    const variantes: Record<string, VarianteResult> = {};
    const RASTER_VARIANTS: DiagnosticGpuVariant[] = ['raster-calcul', 'raster-hybride'];
    for (const variante of RASTER_VARIANTS) {
      const calcul = await rendu(device, onDiag, {
        diagnosticDetail: 'trace',
        diagnosticGpuVariant: variante,
      });
      variantes[variante] = {
        clusters: calcul.metriques.clusters,
        ...compare(materiel.pixels, calcul.pixels, bande),
      };
    }
    let couverts = 0;
    for (let i = 0; i < materiel.pixels.length; i += 4)
      if (!estFond(materiel.pixels, i)) couverts++;
    const info = await appareil.fermer();
    return {
      adaptateur: info.court,
      couverts,
      clusters: materiel.metriques.clusters,
      variantes,
      evenements,
      erreurs,
    };
  } catch (error) {
    const trace = error instanceof Error ? (error.stack ?? '') : '';
    return { erreur: String(error) + trace, evenements, erreurs };
  }
}
