export type GpuHiz = {
  width: number;
  height: number;
  level0: GPUTexture;
  level0View: GPUTextureView;
  flags: GPUBuffer;
  encodePyramid(encoder: GPUCommandEncoder): void;
  /**
   * Adopte les boîtes testées et l'état de l'image que la partition GPU écrit. Elle est montée après
   * la pyramide — elle lit `flags` —, si bien que le groupe de liaison ne les connaît qu'ici. Sans
   * cet appel, `encodeTest` n'encode rien : aucune ligne n'est alors testée, donc aucune rejetée.
   */
  attach(bounds: GPUBuffer, state: GPUBuffer): void;
  /** Les mips de la pyramide, décalage et largeur : ce que la partition lit pour exprimer un
   *  rectangle d'écran en texels du mip qui le couvre exactement. */
  levels(): Array<{ offset: number; width: number }>;
  /**
   * Teste les boîtes que la partition a compactées ; leur nombre vit dans l'état, et le processeur
   * ne le lit pas. `maxRows` borne le lancement — toute ligne dessinable peut avoir été testée —, et
   * `flagRows` entrées de verdict sont remises à zéro d'abord, si bien qu'une ligne que cette image
   * ne teste pas lit 0 au lieu du verdict d'une image antérieure.
   */
  encodeTest(
    device: GPUDevice,
    encoder: GPUCommandEncoder,
    maxRows: number,
    flagRows: number,
  ): number;
  resize(device: GPUDevice, width: number, height: number): boolean;
  dispose(): void;
};
