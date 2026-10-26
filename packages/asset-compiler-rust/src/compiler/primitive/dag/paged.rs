//! The pages of a primitive's DAG (`build_dag_primitive`): each cluster encoded, the pages assigned
//! to streaming pages by the culling hierarchy, the collider cooked beside them, and the reports of
//! the DAG's structure and of its hierarchy.
use super::EncodePage;
use crate::compiler::hierarchy::{dag_hierarchy, ranks_of};
use crate::compiler::pages::bundles::{assign_pages, Laying};
use crate::compiler::primitive::climb::level0_collision;
use crate::dag::{DagBuild, DagCluster, DagGroup};
use crate::*;
use trillion3d_page_codec::bits::grid::PageGrid;
use trillion3d_page_codec::culling::{CullingNode, CULLING_MEASURES, CULLING_STRIDE};

/// A DAG's pages, the plane each cluster lies in, their run, the primitive's collider and the
/// reports of the structure of its DAG and of its culling hierarchy.
pub(super) struct Paged {
    pub pages: Vec<Value>,
    pub cluster_planes: Vec<Option<crate::coplanar::ClusterPlane>>,
    pub page_run: Option<PageRun>,
    pub collision: Value,
    pub structure_report: Value,
    pub culling_report: Value,
}

/// The pages of the DAG `built`, whose clusters index the positions `pos` and the attributes
/// `carried`, on `grid`: each cluster encoded, then the streaming pages, over the encoded bytes —
/// the cluster ranks are their fill order, and the hierarchy's leaves their group parts
/// (`compiler/hierarchy.rs`); metres per object unit, by `object_units`, band them —,
/// then the collider and the pages' bytes side by side. `own_collider` cooks the collider over the
/// primitive's own level 0 alone (`level0_collision`).
///
/// No slot of a primitive is held by a cell: every one is the pinned cover's, and the root pages
/// are its mesh's (`Laying`; only the world's HLOD holds slots, `hlod/chain/bundles.rs`). The
/// closures are made where they are read — here and on the pages' thread —, so no thread is handed
/// another's. The collider and the pages read the same DAG and neither reads what the other
/// writes: they run side by side on the compiler's pool, each result kept in its own place, so
/// every byte is the serial cook's, and the cook's error still comes first.
pub(super) fn page_dag(
    (o, laps): (&Options, &mut crate::support::perf::Laps),
    (built, pos, carried): (&DagBuild, &[f32], &[&encode::Attribute]),
    (grid, root_pages, scale, own_collider): (PageGrid, usize, Option<f64>, bool),
    encode_packed: EncodePage<'_>,
) -> Result<Paged> {
    let (dag, groups, indices) = (&built.clusters[..], &built.groups[..], &built.indices[..]);
    // A vertex a solved reduction placed deforms as the source vertex it came from.
    let origin = (built.grown.as_ref()).map_or(&[][..], |grown| grown.origin.as_slice());
    // One box per cluster, over the positions its page decodes to, for the hierarchy and the page
    // record alike: a vertex lands on the grid's cell, up to half a cell off where it was.
    let clusters = crate::dag::bounds::culling_clusters(&grid.decoded(pos), dag);
    let encode = |slice: &[u32]| encode_packed(slice, pos, carried, origin, grid);
    let encoded = encode_clusters(o, (dag, &clusters), pos, &encode)?;
    laps.lap("encodeMs");
    let metres = 1.0 / trillion3d_page_codec::proxy::object_units(1.0, scale);
    let (held, root_pages_of) = (
        |_: usize| -> Option<usize> { None },
        |_: Option<usize>| root_pages,
    );
    let laying = || Laying {
        positions: pos,
        held: &held,
        root_pages: &root_pages_of,
        scale: metres,
    };
    let assigned = assign_pages((dag, groups), &laying(), &|slot| encoded[slot].resident)?;
    let culled = crate::support::perf::Timer::new(crate::support::perf::Phase::Culling);
    let (order, culling) = dag_hierarchy(dag, &clusters, &assigned);
    drop(culled);
    laps.lap("cullingMs");
    let rank_of = ranks_of(&order);
    let (collision, paged) = laps.join(
        ("physicsMs", || match own_collider {
            true => level0_collision(o, dag, (pos, indices), grid),
            false => crate::physics_cook::cook_primitive(o, dag, &order, &culling, pos, indices),
        }),
        ("pagesMs", || {
            let over = (dag, groups, &clusters[..]);
            dag_pages(o, over, encoded, (&order, assigned, &laying()))
        }),
    );
    let collision = collision?;
    let (pages, cluster_planes, page_run) = paged?;
    let (structure_report, culling_report) = reports(dag, groups, &rank_of, &culling);
    Ok(Paged {
        pages,
        cluster_planes,
        page_run,
        collision,
        structure_report,
        culling_report,
    })
}

/// The report of the DAG's structure — its roots and its groups, by page rank (`rank_of`) — and of
/// its culling hierarchy `culling`: a flat node array, `CULLING_STRIDE` numbers per node
/// (`CullingNode::flat`); -1 marks a subtree holding a root. The links and counts, behind the box,
/// the ball and the two errors, are written as integers.
fn reports(
    dag: &[DagCluster],
    groups: &[DagGroup],
    rank_of: &[usize],
    culling: &[CullingNode],
) -> (Value, Value) {
    let mut roots: Vec<usize> = dag
        .iter()
        .enumerate()
        .filter(|(_, cluster)| cluster.is_root())
        .map(|(slot, _)| rank_of[slot])
        .collect();
    roots.sort_unstable();
    let structure_groups: Vec<Value> = groups
        .iter()
        .map(|group| {
            json!({
             "level":group.level,"error":group.error,"sphere":group.sphere,
             "children":group.children.iter().map(|&slot|rank_of[slot]).collect::<Vec<_>>(),
             "outputs":group.outputs.iter().map(|&slot|rank_of[slot]).collect::<Vec<_>>(),
            })
        })
        .collect();
    let structure = json!({"version":STRUCTURE_VERSION,"roots":roots,"groups":structure_groups});
    let mut flat = Vec::with_capacity(culling.len() * CULLING_STRIDE);
    for node in culling {
        for (at, value) in node.flat().into_iter().enumerate() {
            flat.push(if at >= CULLING_MEASURES {
                json!(value as usize)
            } else {
                json!(value)
            });
        }
    }
    let culling = json!({"stride":CULLING_STRIDE,"count":culling.len(),"nodes":flat});
    (structure, culling)
}
