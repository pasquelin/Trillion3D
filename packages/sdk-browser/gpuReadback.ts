/**
 * Les deux relectures que les outils de preuve font, et qu'aucune image ne fait.
 *
 * Ni l'une ni l'autre n'est une passe du rendu : elles allouent leur tampon d'étape, soumettent leur
 * propre copie, attendent le mappage et rendent le tampon. Un moteur qui rend des images ne les
 * appelle jamais — seul un hôte qui veut vérifier ce que la carte a écrit les appelle.
 */

/** Recopie `bytes` octets d'un tampon de la carte, ou `undefined` si l'appareil ne mappe pas. */
export async function readGpuBuffer(
  device: GPUDevice,
  source: GPUBuffer,
  bytes: number,
): Promise<Uint32Array | undefined> {
  if (bytes < 4 || typeof device.createBuffer !== 'function') return undefined;
  const staging = device.createBuffer({
    label: 'WG buffer readback',
    size: bytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder({ label: 'WG buffer readback' });
    encoder.copyBufferToBuffer(source, 0, staging, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const copy = new Uint32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    return copy;
  } finally {
    staging.destroy();
  }
}

/**
 * Recopie une cible `r32float` en un flottant par texel, lignes jointives.
 *
 * Une copie de texture aligne chaque ligne sur deux cent cinquante-six octets : la largeur demandée
 * n'est presque jamais celle du tampon, et les lignes sont donc recollées ici.
 */
export async function readGpuTextureR32F(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<Float32Array | undefined> {
  if (width < 1 || height < 1 || typeof device.createBuffer !== 'function') return undefined;
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const staging = device.createBuffer({
    label: 'WG r32float readback',
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder({ label: 'WG r32float readback' });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: staging, bytesPerRow, rowsPerImage: height },
      [width, height, 1],
    );
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const padded = new Float32Array(staging.getMappedRange());
    const out = new Float32Array(width * height),
      stride = bytesPerRow / 4;
    for (let y = 0; y < height; y++)
      out.set(padded.subarray(y * stride, y * stride + width), y * width);
    staging.unmap();
    return out;
  } finally {
    staging.destroy();
  }
}
