import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { SHADOW_GROUP_LAMP_WGSL } from './groupWgsl.ts';

/** Whether `device` clips a caster by its own distances (`clip-distances`): the lamp groups'
 *  draws then clip each caster to its page (`SHADOW_GROUP_LAMP_WGSL`). */
export const clipsLampGroups = (device: Pick<GPUDevice, 'features'>) =>
  !!device.features?.has('clip-distances');

/** The shadow depth shader `device` compiles: with the lamp groups' clipped entries when it clips
 *  by distances, else as it is (`shader.ts`). */
export const shadowDepthShader = (device: Pick<GPUDevice, 'features'>) =>
  clipsLampGroups(device)
    ? `enable clip_distances;\n${SHADOW_DEPTH_SHADER}\n${SHADOW_GROUP_LAMP_WGSL}`
    : SHADOW_DEPTH_SHADER;
