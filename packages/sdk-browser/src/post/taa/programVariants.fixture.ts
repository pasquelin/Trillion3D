import {
  commandArgs,
  type PassCommands,
} from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'

/** The subgroups of 32 lanes the adapter of the kit's device states. */
export const grantSubgroups = (device: GPUDevice) =>
  void ((device as unknown as { adapterInfo: object }).adapterInfo = {
    subgroupMinSize: 32,
    subgroupMaxSize: 32,
  })

/** The labels of the modules of the update (`resolve`) the `computePasses` set. */
export const resolveLabelsOf = (computePasses: { commands: PassCommands }[]) =>
  computePasses.flatMap(({ commands }) =>
    commandArgs(commands, 'setPipeline')
      .map(([pipeline]) => pipeline as { entryPoint: string; module: { label: string } })
      .filter(({ entryPoint }) => entryPoint === 'resolve')
      .map(({ module }) => module.label),
  )
