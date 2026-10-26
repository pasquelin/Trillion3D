//! What a primitive that carries an assembly's levels is built and cooked under
//! (`compiler/source/assembly.rs`, `dag/assembly.rs`): the instances whose roots climb with its own
//! clusters (`Assembly`) and its collider, cooked over its own level 0 alone (`level0_collision`).
use crate::compiler::hierarchy::dag_hierarchy;
use crate::compiler::pages::bundles::Assignment;
use crate::dag::assembly::{build_with_instances, Climbed, Instance};
use crate::dag::{DagAttributes, DagCluster, DagSettings, MeshShaping, Trim};
use crate::hlod::flatten::merge::Taken;
use crate::simplify::SolveRules;
use crate::voxel::ShapePreservation;
use crate::*;

/// What an assembly asks of a primitive's build (`dag::assembly`): the instances whose roots climb
/// with its own clusters into the levels above — none for a primitive that carries no levels —,
/// and whether the roots of its own DAG are kept for the assemblies that place it.
#[derive(Default)]
pub(crate) struct Assembly<'a> {
    pub instances: &'a [Instance<'a>],
    pub cover: bool,
}

impl Assembly<'_> {
    /// The DAG of the primitive `arrays` describe: its own, or, when it climbs over instances, the
    /// one with the levels above them (`dag::assembly`), each instance's group told.
    pub(super) fn build(
        &self,
        o: &Options,
        arrays: (&[f32], DagAttributes, &[u32]),
        settings: DagSettings,
    ) -> Result<Climbed> {
        if self.instances.is_empty() {
            let (positions, attributes, indices) = arrays;
            let build =
                crate::dag::build_dag(positions, attributes, indices, settings, &|| check(o))?;
            return Ok(Climbed {
                build,
                parents: Vec::new(),
            });
        }
        build_with_instances(arrays, self.instances, settings, &|| check(o))
    }
}

/// What a primitive's part in an assembly decides of its build, once: a primitive that climbs over
/// instances is cut by no trim, voxelized by no seed — its groups list no child of theirs that an
/// instance was —, taken by no merged layer, and its collider is cooked over its own level 0 alone
/// (`level0_collision`); any other is built as its mesh's settings say.
pub(super) struct Role {
    pub trim: Trim,
    pub shape: ShapePreservation,
    pub merged: Option<(Taken, SolveRules)>,
    pub own_collider: bool,
}

impl Role {
    /// The role of a primitive that `climbs` over instances or not, built under `shaping`, the
    /// merged layers taking `taken` of it.
    pub(super) fn of(climbs: bool, shaping: &MeshShaping, taken: Option<Taken>) -> Self {
        match climbs {
            true => Self {
                trim: Trim::default(),
                shape: ShapePreservation::None,
                merged: None,
                own_collider: true,
            },
            false => Self {
                trim: shaping.trim,
                shape: shaping.shape,
                merged: taken.map(|taken| (taken, shaping.rules())),
                own_collider: false,
            },
        }
    }
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
        size: vec![0; own.len()],
    };
    let (order, culling) = dag_hierarchy(&own, &boxes, &one_page);
    crate::physics_cook::cook_primitive(o, &own, &order, &culling, pos, indices)
}
