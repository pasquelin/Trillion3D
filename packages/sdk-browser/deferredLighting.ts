import type { SurfaceBuffer } from './surfaceBuffer.ts';
import {
  COMPOSE_SHADER,
  DIRECT_LIGHTING_SHADER,
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
/** Sans lampe déclarée : zéro lampe, zéro tuile, rien en réserve, exposition 1. */
const ZERO_DIRECT = [0, 0, 0, 0, 0, 0, 0, 1] as const;

/**
 * Le rassemblement différé. Deux programmes vivent ici : la vue sans éclairage — l'albédo brut des
 * matériaux, qui est aussi ce que rend une scène sans lampe déclarée — et celui du contrat. Le
 * second n'est compilé qu'à la première image qui porte une lampe : une scène qui n'en a pas ne le
 * paie jamais.
 */
export async function createDeferredLighting(device: GPUDevice, directLights: GPUBuffer) {
  const uniform = device.createBuffer({
    label: 'WG deferred view v1',
    size: 160,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const placeholders = createDeferredPlaceholders(device);
  const bindings = { uniform, directLights, placeholders };
  try {
    const unlit = await createDeferredProgram(
      device,
      { lighting: UNLIT_LIGHTING_SHADER, compose: COMPOSE_SHADER, label: 'UNLIT', direct: false },
      bindings,
    );
    let contract: DeferredProgram | undefined,
      contractPending: Promise<unknown> | undefined,
      active: DeferredProgram = unlit;
    const packed = new Float32Array(36);
    return {
      uniform,
      /** Vrai quand l'image en cours est rendue par le programme du contrat. */
      get usesContract() {
        return active !== unlit;
      },
      update(
        inverseViewProjection: readonly number[],
        camera: readonly number[],
        width: number,
        height: number,
        clearColor: number,
        diagnostic: boolean,
        direct: ArrayLike<number> = ZERO_DIRECT,
      ) {
        packed.set(inverseViewProjection, 0);
        packed.set(camera, 16);
        packed.set([width, height, diagnostic ? 1 : 0, 0], 20);
        packed.set(
          [(clearColor >> 16) / 255, ((clearColor >> 8) & 255) / 255, (clearColor & 255) / 255, 1],
          24,
        );
        // Lampes du contrat, tuiles en X et Y, réserve ; puis réserve et exposition.
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
        if (wantsContract && !contract && !contractPending)
          contractPending = createDeferredProgram(
            device,
            {
              lighting: DIRECT_LIGHTING_SHADER,
              compose: COMPOSE_SHADER,
              label: 'DIRECT',
              direct: true,
            },
            bindings,
          ).then(
            (program) => (contract = program),
            (error) => onFailure?.(error),
          );
        active = wantsContract && contract ? contract : unlit;
        active.bind(surface, depth, hdr, direct);
      },
      /** Attend la compilation du programme du contrat, quand une est en cours. */
      settle() {
        return Promise.resolve(contractPending).then(() => {});
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
      compose(
        encoder: GPUCommandEncoder,
        target: GPUTextureView,
        clear: GPUColor,
        presentation?: GPUTextureView,
      ) {
        const group = active.composeGroup;
        if (!group) throw new Error('SURFACE_NOT_BOUND');
        // Both UNORM targets receive the same display value. Keep the persistent
        // capture image while avoiding a separate fullscreen read and presentation.
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
        contract?.release();
      },
    };
  } catch (error) {
    uniform.destroy();
    placeholders.dispose();
    throw error;
  }
}
