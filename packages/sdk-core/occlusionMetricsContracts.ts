/**
 * Ce que le test d'occultation Hi-Z d'une image a fait, publié comme tel.
 *
 * Ces sept nombres vivent à part de `FrameMetrics` parce qu'ils ont leur propre RYTHME : sur le
 * chemin GPU ils sont accumulés par la carte — la partition les compte en rangeant les lignes, le
 * noyau d'occultation en écrivant ses verdicts — et l'hôte ne les relit qu'une image sur quinze.
 */
export interface OcclusionFrameMetrics {
  /**
   * Ce que le test d'occultation a fait sur une image : les clusters qu'on lui a remis, ceux qu'il a
   * éliminés, et ceux dont l'empreinte écran de niveau 0 dépasse le noyau de seize texels et qui
   * répondent donc depuis un mip plus grossier. `hiz*Triangles` sont les triangles de ces mêmes
   * clusters.
   *
   * Sur le chemin GPU ils décrivent une image ANTÉRIEURE à celle qui les rend — `hizCountedFrame`
   * nomme laquelle —, comme `gpuPassMs`, et deux images voisines portent souvent le même relevé.
   * Aucun n'est estimé : `null` sur un moteur qui ne teste pas l'occultation, sur un appareil dont
   * les verdicts ne peuvent pas être relus, et tant qu'aucune image n'a été comptée.
   */
  hizTestedClusters?: number | null;
  hizRejectedClusters?: number | null;
  hizOversizedClusters?: number | null;
  hizTestedTriangles?: number | null;
  hizRejectedTriangles?: number | null;
  hizOversizedTriangles?: number | null;
  /**
   * L'image que les six compteurs ci-dessus décrivent. C'est l'image courante là où l'oracle compte
   * sur le processeur, et une image antérieure sur le chemin GPU, dont les compteurs sont relus
   * périodiquement ; sans elle, un lecteur ne peut pas distinguer un compte de cette image-ci d'un
   * compte que la dernière image relevée a laissé derrière elle. `null` quand il n'y en a aucune.
   */
  hizCountedFrame?: number | null;
}
