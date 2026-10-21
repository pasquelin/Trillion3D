//! THE CULLING HIERARCHY OF A DAG over its page assignment, a primitive's
//! (`primitive/dag.rs`) and each world actor's (`../hlod/chain/merge.rs`): the clusters ranked in the
//! order its streaming pages are filled (`compiler/pages/bundles.rs:assign_pages`), so each GROUP
//! PART — the clusters of one group one page holds — is a run of consecutive ranks; the parts
//! (`culling_parts`), then the tree over them (`trillion3d_page_codec::culling::build_culling_bvh`).
use crate::compiler::pages::bundles::Assignment;
use crate::dag::DagCluster;
use trillion3d_math::geometry::aabb::merge_aabb;
use trillion3d_page_codec::culling::{build_culling_bvh, CullingCluster, CullingNode, CullingPart};

/// The cluster order of `assigned` (rank → slot), made over the DAG's slots: its pages one after
/// the other, each page's clusters in the order it was filled.
pub(crate) fn paged_order(assigned: &Assignment) -> Vec<usize> {
    assigned.pages.iter().flatten().copied().collect()
}

/// The rank of each slot in `order` (rank → slot): its inverse.
pub(crate) fn ranks_of(order: &[usize]) -> Vec<usize> {
    let mut ranks = vec![0usize; order.len()];
    for (rank, &slot) in order.iter().enumerate() {
        ranks[slot] = rank;
    }
    ranks
}

/// `values`, by slot, laid in `order` (rank → slot): the value of the slot at each rank. `order`
/// names every slot once.
pub(crate) fn permuted<T>(values: &mut Vec<T>, order: &[usize]) {
    let mut taken: Vec<Option<T>> = std::mem::take(values).into_iter().map(Some).collect();
    *values = order
        .iter()
        .map(|&slot| taken[slot].take().expect("a permutation"))
        .collect();
}

/// The group parts of the clusters of `dag` laid in `order` (rank → slot), `boxes` each slot's box
/// and band (`dag::bounds::culling_clusters`), `page_of` each slot's streaming page: a run of ranks
/// of one group in one page is one part — a root, which no group holds, a part of its own, as the
/// one cluster of the reference's root group. A part takes the box of its clusters' boxes, their
/// level, their group's ball and replacement error, and the least of their own errors.
pub(crate) fn culling_parts(
    dag: &[DagCluster],
    boxes: &[CullingCluster],
    order: &[usize],
    page_of: &[usize],
) -> Vec<CullingPart> {
    let mut parts: Vec<CullingPart> = Vec::new();
    for (rank, &slot) in order.iter().enumerate() {
        let (cluster, own) = (&boxes[slot], dag[slot].lod_error);
        let joins = rank > 0 && {
            let before = order[rank - 1];
            dag[slot].group.is_some()
                && dag[before].group == dag[slot].group
                && page_of[before] == page_of[slot]
        };
        match parts.last_mut() {
            Some(part) if joins => {
                merge_aabb(&mut part.min, &mut part.max, cluster.min, cluster.max);
                part.level = part.level.max(cluster.level);
                part.min_error = part.min_error.min(own);
                part.count += 1;
            }
            _ => parts.push(CullingPart {
                min: cluster.min,
                max: cluster.max,
                level: cluster.level,
                sphere: cluster.parent_sphere,
                min_error: own,
                parent_error: cluster.parent_error,
                first: rank,
                count: 1,
            }),
        }
    }
    parts
}

/// The culling hierarchy of `dag` over its page assignment `assigned`, made over its slots: the
/// cluster order (`paged_order`) and the tree over its group parts (`culling_parts`).
pub(crate) fn dag_hierarchy(
    dag: &[DagCluster],
    boxes: &[CullingCluster],
    assigned: &Assignment,
) -> (Vec<usize>, Vec<CullingNode>) {
    let order = paged_order(assigned);
    let parts = culling_parts(dag, boxes, &order, &assigned.page_of);
    (order, build_culling_bvh(&parts))
}

/// The hierarchy the tests read of `dag` over `positions` without encoding its pages: its pages
/// assigned as a primitive's, every cluster weighing one byte (`dag_hierarchy`).
#[cfg(test)]
pub(crate) fn test_hierarchy(
    positions: &[f32],
    (dag, groups): (&[DagCluster], &[crate::dag::DagGroup]),
) -> (Vec<usize>, Vec<CullingNode>) {
    use crate::compiler::pages::bundles::{assign_pages, Laying};
    let boxes = crate::dag::bounds::culling_clusters(positions, dag);
    let (held, roots) = (|_: usize| -> Option<usize> { None }, |_: Option<usize>| 1);
    let laying = Laying {
        positions,
        held: &held,
        root_pages: &roots,
        scale: 1.0,
    };
    let assigned = assign_pages((dag, groups), &laying, &|_| 1).expect("one-byte clusters fit");
    dag_hierarchy(dag, &boxes, &assigned)
}
