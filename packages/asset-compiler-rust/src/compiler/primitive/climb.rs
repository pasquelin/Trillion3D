//! What a primitive that carries an assembly's levels is built and cooked under
//! (`compiler/source/assembly.rs`, `dag/assembly.rs`): the instances whose roots climb with its own
//! clusters (`Assembly`) and its collider, cooked over its own level 0 alone (`level0_collision`).
use crate::compiler::hierarchy::dag_hierarchy;
use crate::compiler::pages::bundles::Assignment;
use crate::dag::assembly::Instance;
use crate::dag::DagCluster;
use crate::*;

/// What an assembly asks of a primitive's build (`dag::assembly`): the instances whose roots climb
/// with its own clusters into the levels above — none for a primitive that carries no levels —,
/// and whether the roots of its own DAG are kept for the assemblies that place it.
#[derive(Default)]
pub(crate) struct Assembly<'a> {
    pub instances: &'a [Instance<'a>],
    pub cover: bool,
}

/// The collider of a primitive that carries an assembly's levels: its own level 0 alone, cooked as
/// a DAG of one page of roots — the clusters the levels above its instances made draw what its
/// instances' parts collide as, each by its own —; none for a primitive with no triangle of its
/// own.
pub(super) fn level0_collision(
    o: &Options,
    dag: &[DagCluster],
    (pos, indices): (&[f32], &[u32]),
    grid: trillion3d_page_codec::bits::grid::PageGrid,
) -> Result<Value> {
    let own: Vec<DagCluster> = (dag.iter().filter(|c| c.level == 0))
        .map(|c| DagCluster {
            parent_error: f64::INFINITY,
            group: None,
            source: None,
            ..c.clone()
        })
        .collect();
    if own.is_empty() {
        return Ok(json!({"refused": "it holds no triangle of its own"}));
    }
    let boxes = crate::dag::bounds::culling_clusters(&grid.decoded(pos), &own);
    let one_page = Assignment {
        pages: vec![(0..own.len()).collect()],
        root: vec![true],
        pinned: 1,
        page_of: vec![0; own.len()],
    };
    let (order, culling) = dag_hierarchy(&own, &boxes, &one_page);
    crate::physics_cook::cook_primitive(o, &own, &order, &culling, pos, indices)
}
