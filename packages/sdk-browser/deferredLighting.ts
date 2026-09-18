import type { SurfaceBuffer } from './surfaceBuffer.ts';
import {
  BOUNCE_LIGHTING_SHADER,
  COMPOSE_SHADER,
  DIRECT_LIGHTING_SHADER,
  UNLIT_COMPOSE_SHADER,
  UNLIT_LIGHTING_SHADER,
} from './deferredLightingShaders.ts';
import { createDeferredPlaceholders } from './deferredLightingSetup.ts';
import {
  createDeferredProgram,
  type DeferredProgram,
  type DirectLightResources,
} from './deferredLightingProgram.ts';
export { DIRECT_LIGHTING_SHADER, FULLSCREEN_VERTEX } from './deferredLightingShaders.ts';

/** Étiquette de la passe mesurée ; `gpuLightingMs` est lu sous ce nom. */
export const DEFERRED_LIGHTING_PASS = 'WG deferred lighting';
/** Sans lampe déclarée : zéro lampe, zéro tuile, exposition 1. */
const ZERO_DIRECT = [0, 0, 0, 1] as const;

/**
 * Le rassemblement différé. Deux programmes vivent ici : la vue sans éclairage — l'albédo brut des
 * matériaux, composé par l'identité, qui est aussi ce que rend une scène sans lampe déclarée — et
 * celui du contrat, exposé puis passé dans ACES. Le second n'est compilé qu'à la première image qui
 * porte une lampe : une scène qui n'en a pas ne le paie jamais.
 *
 * `onReady` est appelé à chaque arrivée d'un programme du contrat, DIRECT comme BOUNCE. C'est la
 * seule annonce de ce changement d'image : la compilation se termine entre deux images, sans que
 * l'appelant ait rien demandé, et l'image suivante rendrait encore l'albédo brut si personne ne le
 * disait. Un programme qui arrive alors que sa variante n'est plus demandée fait refaire une image
 * de plus, jamais une image fausse.
 */
export async function createDeferredLighting(
  device: GPUDevice,
  directLights: GPUBuffer,
  onReady?: () => void,
) {
  const uniform = device.createBuffer({
    label: 'WG deferred view v1',
    size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const placeholders = createDeferredPlaceholders(device);
  const bindings = { uniform, directLights, placeholders };
  try {
    const unlit = await createDeferredProgram(
      device,
      // La vue sans lampe compose par l'identité : sans source déclarée, aucune radiance n'est à
      // exposer ni à ramener dans la plage d'affichage, et l'albédo doit se lire tel quel (P6).
      {
        lighting: UNLIT_LIGHTING_SHADER,
        compose: UNLIT_COMPOSE_SHADER,
        label: 'UNLIT',
        direct: false,
      },
      bindings,
    );
    // Trois programmes, jamais une branche : la vue sans éclairage, le contrat, et le contrat plus
    // le rebond. Une session sans rebond exécute ainsi exactement le nuanceur d'avant.
    type Variant = { program?: DeferredProgram; pending?: Promise<unknown> };
    const variants: Record<'direct' | 'bounce', Variant> = { direct: {}, bounce: {} };
    let active: DeferredProgram = unlit;
    const packed = new Float32Array(32);
    // Les vues de diagnostic sortent des valeurs brutes : ni ACES, ni sRGB, ni fond composé. La
    // vue d'irradiance indirecte en est une, et c'est l'éclairage qui le dit, pas l'appelant.
    let rawOutput = false;
    return {
      uniform,
      /** Ce que vaut une ressource du contrat absente : la passe de mélange lie les mêmes. */
      placeholders,
      /** Sort l'image en valeurs brutes, sans la chaîne d'affichage. Pour une vue de mesure. */
      setRawOutput(value: boolean) {
        rawOutput = value;
      },
      /** Vrai quand l'image en cours est rendue par un programme du contrat. */
      get usesContract() {
        return active !== unlit;
      },
      update(
        inverseViewProjection: ArrayLike<number>,
        camera: readonly number[],
        width: number,
        height: number,
        clearColor: number,
        diagnostic: boolean,
        direct: ArrayLike<number> = ZERO_DIRECT,
      ) {
        packed.set(inverseViewProjection as ArrayLike<number> & number[], 0);
        packed.set(camera, 16);
        packed.set([width, height, diagnostic || rawOutput ? 1 : 0, 0], 20);
        packed.set(
          [(clearColor >> 16) / 255, ((clearColor >> 8) & 255) / 255, (clearColor & 255) / 255, 1],
          24,
        );
        // Lampes du contrat, tuiles en X et Y, puis l'exposition.
        packed.set(direct as number[], 28);
        device.queue.writeBuffer(uniform, 0, packed);
      },
      /**
       * Choisit le programme de l'image et lie ses ressources. `wantsContract` reste faux tant que
       * l'hôte n'a déclaré aucune lampe, ou tant qu'il demande la vue sans éclairage ; la
       * compilation du programme du contrat est lancée à la première demande et la vue sans
       * éclairage reste correcte pendant qu'elle se termine.
       */
      bind(
        surface: SurfaceBuffer,
        depth: GPUTextureView,
        hdr: GPUTextureView,
        wantsContract: boolean,
        direct: DirectLightResources = {},
        onFailure?: (error: unknown) => void,
      ) {
        const wantsBounce = wantsContract && !!direct.bounceGrid && !!direct.probes;
        const variant = variants[wantsBounce ? 'bounce' : 'direct'];
        if (wantsContract && !variant.program && !variant.pending)
          variant.pending = createDeferredProgram(
            device,
            {
              lighting: wantsBounce ? BOUNCE_LIGHTING_SHADER : DIRECT_LIGHTING_SHADER,
              compose: COMPOSE_SHADER,
              label: wantsBounce ? 'BOUNCE' : 'DIRECT',
              direct: true,
              bounce: wantsBounce,
            },
            bindings,
          ).then(
            (program) => {
              variant.program = program;
              onReady?.();
            },
            (error) => onFailure?.(error),
          );
        // Le programme du rebond met une image ou deux à se compiler : celui du contrat rend
        // l'image en attendant, sans rebond, plutôt que de faire attendre l'image.
        active =
          (wantsContract ? (variant.program ?? variants.direct.program) : undefined) ?? unlit;
        active.bind(surface, depth, hdr, direct);
      },
      /** Attend les compilations de programmes du contrat en cours, quand il y en a. */
      settle() {
        return Promise.all([variants.direct.pending, variants.bounce.pending]).then(() => {});
      },
      light(encoder: GPUCommandEncoder, target: GPUTextureView) {
        const group = active.lightGroup;
        if (!group) throw new Error('SURFACE_NOT_BOUND');
        const pass = encoder.beginRenderPass({
          label: DEFERRED_LIGHTING_PASS,
          colorAttachments: [
            { view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
          ],
        });
        pass.setPipeline(active.light);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
      },
      /** Compose `source` — l'image éclairée par défaut, ou la sortie de l'antialiasing temporel. */
      compose(
        encoder: GPUCommandEncoder,
        target: GPUTextureView,
        clear: GPUColor,
        presentation?: GPUTextureView,
        source?: GPUTextureView,
      ) {
        const group = active.composeGroup(source);
        if (!group) throw new Error('SURFACE_NOT_BOUND');
        const colorAttachments: GPURenderPassColorAttachment[] = [
          { view: target, loadOp: 'clear', storeOp: 'store', clearValue: clear },
        ];
        if (presentation)
          colorAttachments.push({
            view: presentation,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: clear,
          });
        const pass = encoder.beginRenderPass({
          label: presentation ? 'WG HDR composition + present' : 'WG HDR composition',
          colorAttachments,
        });
        pass.setPipeline(presentation ? active.composePresent : active.compose);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
      },
      dispose() {
        uniform.destroy();
        placeholders.dispose();
        unlit.release();
        variants.direct.program?.release();
        variants.bounce.program?.release();
      },
    };
  } catch (error) {
    uniform.destroy();
    placeholders.dispose();
    throw error;
  }
}
