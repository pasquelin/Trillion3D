import { skyTableMips } from '../pathTracing/skyWgsl.ts'

/** The sky's table: the radiance in floats, the density a float. */
export const SKY_TABLE_TEXTURE_FORMAT = 'rgba32float' as const
export const SKY_TABLE_PDF_FORMAT = 'r32float' as const

/** Bytes between two blocks of the table's parameters: a uniform's offset alignment. */
export const SKY_TABLE_BLOCK = 256

/** The bytes of a table `size` texels across: the radiance (four floats a texel), the density (a float) and its mip chain (a third more). */
export const skyTableBytes = (size: number) => size * size * (16 + 4) + (size * size * 4) / 3

/**
 * THE SKY'S SAMPLING TABLE, shared by every pass that draws directions from the sky (the path tracer, the ray-traced sky light): the radiance along the direction of each cell of an equal-area
 * map of the sphere (`texture`), a density for each cell with its mip chain down to the one texel of its mean (`pdf`), and the buffer of the parameters of the build's passes (`build`, one block
 * a level). `label` names the owner in the resources' labels.
 */
export function createSkyTable(device: GPUDevice, size: number, label: string) {
  const mips = skyTableMips(size)
  const texture = (name: string, format: GPUTextureFormat, levels: number) =>
    device.createTexture({
      label: `${label} ${name}`,
      size: [size, size],
      format,
      mipLevelCount: levels,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    })
  const radiance = texture('sky', SKY_TABLE_TEXTURE_FORMAT, 1)
  const pdf = texture('sky density', SKY_TABLE_PDF_FORMAT, mips)
  const build = device.createBuffer({
    label: `${label} sky table parameters`,
    size: SKY_TABLE_BLOCK * (mips + 1),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return {
    size,
    mips,
    radiance,
    pdf,
    build,
    /** The views a pass binds, made once so that its groups are. */
    radianceView: radiance.createView(),
    pdfView: pdf.createView(),
    destroy() {
      radiance.destroy()
      pdf.destroy()
      build.destroy()
    },
  }
}
export type SkyTable = ReturnType<typeof createSkyTable>
