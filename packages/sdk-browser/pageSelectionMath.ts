import { projectedErrorAt, viewDepth, viewLateral } from './pageSelectionProjection.ts';

export type ClusterCut = {
  lodError?: number;
  sphere?: number[];
  parentError?: number | null;
  parentSphere?: number[] | null;
  group?: number | null;
  source?: number | null;
};
/** Projected screen error of one (error, object-space sphere) pair, in the frame given by `e`. */
export function projectedClusterError(
  error: number | null | undefined,
  sphere: ArrayLike<number> | null | undefined,
  offset: number,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
) {
  // Exact geometry and clusters with no replacement need no projection at all, which is most of them.
  // Une seule garde de plus que `projectedErrorAt`, à qui la projection est laissée : l'absence de
  // sphère. Les deux autres restent posées ici, avant les deux racines carrées de la projection,
  // parce que le cas le plus fréquent de la coupe est justement un cluster d'erreur nulle.
  if (error === 0) return 0;
  if (error == null || error === Infinity || !sphere) return Infinity;
  return projectedErrorAt(
    error,
    viewLateral(sphere, offset, e),
    viewDepth(sphere, offset, e),
    sphere[offset + 3],
    stretch,
    focal,
    near,
  );
}
export function cutSelects(
  rec: ClusterCut,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  pixelError: number,
) {
  const sphere = rec.sphere,
    own = rec.lodError ?? 0,
    parent = rec.parentError;
  // Un cluster dont le remplaçant n'a pas de sphère à lui reprend la sienne : les deux membres du
  // test projetaient alors deux fois la même sphère, donc quatre racines carrées par enregistrement
  // au lieu de deux. Une seule projection, partagée comme `nodeDecision` partage déjà la sienne ;
  // `projectedErrorAt` reçoit les mêmes opérandes dans le même ordre que `projectedClusterError`.
  if (sphere && own !== 0 && own !== Infinity && rec.parentSphere == null) {
    const lateral = viewLateral(sphere, 0, e),
      depth = viewDepth(sphere, 0, e),
      radius = sphere[3];
    if (projectedErrorAt(own, lateral, depth, radius, stretch, focal, near) > pixelError)
      return false;
    return projectedErrorAt(parent, lateral, depth, radius, stretch, focal, near) > pixelError;
  }
  if (projectedClusterError(own, sphere, 0, e, stretch, focal, near) > pixelError) return false;
  return (
    projectedClusterError(parent, rec.parentSphere ?? sphere, 0, e, stretch, focal, near) >
    pixelError
  );
}
