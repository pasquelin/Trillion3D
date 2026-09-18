import * as THREE from 'three';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { autonomousPagesBackend } from './autonomousPages.ts';
import { DEFAULT_BACKENDS } from './defaultBackends.ts';
import { DEFAULT_CLEAR_COLOR } from './backendCommon.ts';
import { createSceneLightStore, dagWarningsDiagnostic } from '../sdk-core/index.ts';
import { createSceneProxyReader } from './sceneProxyLoad.ts';
import { createTextureLevelReader } from './textureLevelReader.ts';
import { resolveDiagnosticGpuVariant } from './diagnosticGpuVariant.ts';
import { declareImportedLights, loadImportedLights } from './importedLights.ts';
import type { BackendContext, RenderBackend } from './backendTypes.ts';
import type { createExplorerPageSources } from './explorerPageSources.ts';
import type { ExplorerSession } from './explorerSession.ts';

type Inputs = {
  source: THREE.Object3D;
  sceneLightingSource?: THREE.Object3D;
  associations: BackendContext['associations'];
  textureIndices: Map<THREE.Texture, number>;
  pageSources: Awaited<ReturnType<typeof createExplorerPageSources>>;
  gpuDevice?: GPUDevice;
  directGpu: boolean;
  autonomous: boolean;
  backends: RenderBackend[];
  /** Base d'url du manifeste : c'est elle qui situe l'objet de cache du proxy résident. */
  base: string;
};

export async function prepareExplorerBackends(session: ExplorerSession, inputs: Inputs) {
  const { canvas, options, scope, metadata, signal, diagnosticChannel, emit, diagnose } = session;
  const {
    source,
    sceneLightingSource,
    associations,
    textureIndices,
    pageSources,
    gpuDevice,
    directGpu,
    autonomous,
    backends,
    base,
  } = inputs;
  const { indices, streamer, attachCap, cacheCap, preload } = pageSources;
  const viewport: [number, number] = [canvas.width, canvas.height];
  // Un seul magasin de lampes par session : chaque moteur le lit, l'hôte est le seul à l'écrire.
  const sceneLights = createSceneLightStore();
  // Les lampes que le fichier source portait, déclarées avant le premier moteur : la vue `auto` sait
  // dès sa première image qu'elle a une source, et aucun moteur ne se prépare sur un magasin vide
  // qu'il faudrait repousser ensuite. Un cache sans ce produit n'en déclare aucune, comme avant.
  let importedLightIds: string[] = [];
  if (options.importedLights !== false) {
    const imported = await loadImportedLights(base, signal);
    const { declared, dropped } = declareImportedLights(sceneLights, imported.lights);
    importedLightIds = declared;
    if (declared.length || dropped || Object.keys(imported.rejected).length)
      diagnose('imported-lights', 'Lampes déclarées par le fichier source', {
        kind: 'preparation',
        declared: declared.length,
        dropped,
        rejected: imported.rejected,
        maxLights: sceneLights.settings.maxLights,
        scope,
      });
  }
  // Ce que le compilateur a nommé sans pouvoir le corriger — un DAG qui n'est pas monté — se dit
  // à l'ouverture, avant le choix du moteur : c'est un fait du cache, pas d'un moteur.
  const dagWarnings = dagWarningsDiagnostic(metadata.primitives);
  if (dagWarnings)
    diagnose(dagWarnings.phase, dagWarnings.message, {
      kind: 'preparation',
      ...dagWarnings.context,
    });
  const context: BackendContext = {
    source,
    metadata,
    indices,
    readPage: (url) => streamer.read(url),
    readGeometryPage: (url) => streamer.readBytes(url),
    associations: associations,
    textureIndices,
    signal,
    // Le plafond en pages est celui de l'hôte, ou rien : le moteur WebGPU tient son pool en octets
    // ; les moteurs à mémoire hôte gardent par défaut ce que le diffuseur a calculé pour eux.
    maxResidentPages: options.maxResidentPages,
    residentPagesDefault: attachCap,
    maxCachedPages: cacheCap,
    pixelError: options.pixelError ?? 0,
    lodAdaptive: options.lodAdaptive,
    clearColor: options.clearColor ?? DEFAULT_CLEAR_COLOR,
    onDiagnostic: diagnosticChannel.enabled ? diagnosticChannel.emit : undefined,
    diagnosticDetail: diagnosticChannel.detail,
    viewport,
    gpuDevice,
    gpuCanvas: directGpu ? canvas : undefined,
    maxTextureTransferBytesPerFrame: options.maxTextureTransferBytesPerFrame,
    temporalAntialiasing: options.temporalAntialiasing ?? true,
    geometryPoolBytes: options.geometryPoolBytes,
    geometryPoolCeilingBytes: options.geometryPoolCeilingBytes,
    texturePoolBytes: options.texturePoolBytes,
    stageProfile: options.stageProfile === true,
    // La variante de diagnostic est vérifiée ici, une fois : hors `trace`, elle est refusée.
    diagnosticGpuVariant: resolveDiagnosticGpuVariant(
      options.diagnosticGpuVariant,
      diagnosticChannel.detail,
    ),
    shadowBudgetMs: options.shadowBudgetMs,
    shadowPageInvalidation: options.shadowPageInvalidation,
    sceneLighting: sceneLightingSource,
    // La lumière qui rebondit reste éteinte par défaut : son étape mesurée tient 1,1 à 1,3 ms sur
    // Emerald, au-dessus de la barre d'une milliseconde, et l'hôte l'allume explicitement.
    bounce: options.bounce,
    bounceBudgetMs: options.bounceBudgetMs,
    readSceneProxy: createSceneProxyReader(metadata.proxy, base, signal),
    // Le lecteur n'existe qu'à la demande de l'hôte : sous `'host'`, le chargeur a lu et décodé
    // les images, et le moteur prend le chemin d'avant — les lire une seconde fois dans le cache
    // doublerait le réseau pour la même image.
    readTextureLevel:
      options.textureSource === 'cache'
        ? createTextureLevelReader(metadata.textures, base, signal)
        : undefined,
    sceneLights,
    importedLightIds,
  };
  const factories = autonomous
    ? [autonomousPagesBackend]
    : (options.backends ??
      (gpuDevice ? [...DEFAULT_BACKENDS, webgpuPagesBackend] : DEFAULT_BACKENDS));
  for (const factory of factories) {
    const backend = factory(context);
    if (backends.some((b) => b.id === backend.id)) throw new Error('Duplicate backend id');
    diagnose('backend-preparation-start', 'Backend preparation started', {
      kind: 'preparation',
      backend: backend.id,
      scope,
    });
    try {
      await backend.prepare();
      backends.push(backend);
      diagnose('backend-preparation-complete', 'Backend preparation completed', {
        kind: 'preparation',
        backend: backend.id,
        scope,
      });
    } catch (error) {
      diagnose('backend-preparation-error', 'Backend preparation failed', {
        kind: 'error',
        backend: backend.id,
        error: String(error),
        scope,
      });
      backend.dispose();
      if (backend.id === 'webgpu-page-raster' && !directGpu) {
        emit({
          eventVersion: 1,
          type: 'fallback',
          audience: 'diagnostic',
          recovered: true,
          code: 'WEBGPU_UNAVAILABLE',
          detail: String(error),
        });
        diagnose('fallback', 'WebGPU backend unavailable; continue with other backends', {
          kind: 'fallback',
          backend: backend.id,
          error: String(error),
          scope,
        });
        continue;
      }
      throw error;
    }
  }
  if (preload !== 'all') indices.clear();
  if (!backends.length) throw new Error('No backend');
  return { viewport, context };
}
