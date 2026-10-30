//! The world's HLOD builds (`merge.rs` splices them), per cell of the layer below its actors, each
//! a mesh wearing a material (`Wears`, `../flatten.rs`), built through `dag::build_dag` as any
//! primitive's is. A layer that asks for a cluster DAG (`clusterDag`) gets the same clustering,
//! grouping, simplification and monotone error, the actor's own; by default the mesh is its level
//! 0 alone — exact clusters, every one a root, no group, no simplification — and the runtime draws
//! it whole at every distance, as a plain merged mesh is drawn (`build`).
//!
//! Every level is built from its cell's original objects — every object under the cell, at HLOD 1
//! an HLOD 0 cell's, above it those of every HLOD 0 cell under it —, its shape and its texture
//! alike: no level reads an actor of the level below, its mesh nor its atlas.
//!
//! - an approximated layer (`flatten::Recipe::Shell`): the objects approximated by a closed shell,
//!   the objects read onto it in their materials (`flatten::approximated`);
//! - a merged layer (`flatten::merge`): the objects at the LOD a mesh shows when it spans the
//!   layer's screen size, merged as they are — one actor per material, each wearing its material
//!   of the scene, or, its materials merged, one actor wearing its own;
//! - a voxel layer (`voxels.rs`): the objects voxelized together, levels of bricks with no shell
//!   nor atlas.
//!
//! Every cell's actors are one job of a single admission (`compiler::budget::admission`): no job
//! reads another's, so the jobs of every level run side by side — no barrier between layers nor
//! between a cell and the cells below it —, each estimated from the objects it reads
//! (`working_bytes`, `merged_bytes`, `voxels::working_bytes`), the longest first — its own work,
//! its critical path (`schedule::SHELL_WEIGHT`) —, as many at once as the process's resident memory
//! admits. The jobs come back in cell order, the order the layers and their cells always ranked
//! the actors in, whatever order they ran in.
//! The actors' builds live in `actors`, the objects standing as themselves in `instanced`, the
//! distance field of a cell's actors in `fields`, the measures in `measures`, the world's jobs in
//! `schedule`.
use super::*;
use crate::dag::{
    build_dag, DagAttributes, DagBuild, DagCluster, DagGroup, DagSettings, DagStrategy, InputRules,
    MeshShaping,
};
use crate::hlod::flatten::bake::publish::{images, Image};
use crate::hlod::flatten::{step, timed, Library};
use crate::Hlod;
use trillion3d_page_codec::bits::grid::Extent;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_TANGENT, FLAG_UV};
mod actors;
mod fields;
mod instanced;
mod measures;
mod schedule;
pub(super) use instanced::{lay_rows, ActorRow};
pub(super) use schedule::world_dag;

/// A world build: its clusters and groups, the positions and attributes they index, and the boxes
/// of every cluster the build made, the finest detail its trim cut away included (`cut_finest`),
/// which set its pages' grid.
pub(crate) type Built = (
    (Vec<DagCluster>, Vec<DagGroup>),
    Vec<f32>,
    Vec<Attribute>,
    Vec<Extent>,
);

/// What builds the world: the job's cancel check, its progress events, the source materials and
/// each one's class among equivalent ones (`flatten::merge::classes`), the job, its HLOD and the
/// bytes the process may hold resident while the actors are made (`Room::Measured`).
pub(crate) struct Builder<'a> {
    pub checkpoint: &'a (dyn Fn() -> Result<()> + Sync),
    pub progress: &'a (dyn Fn(Value) + Sync),
    pub library: &'a Library,
    pub classes: &'a crate::hlod::flatten::merge::Classes,
    /// The sky property of each material of the source scene, by its glTF rank
    /// (`MaterialOptions::sky_flags`): an actor made of sky materials alone wears a sky material.
    pub sky: &'a [bool],
    pub o: &'a Options,
    pub hlod: &'a Hlod,
    pub room: usize,
}

/// One build of `positions`, `carried` and `indices`: the DAG, its groups and the arrays its
/// clusters index — the actor's, followed by every vertex the DAG's solves placed (`Grown`) —; with
/// no `dag` (a layer's `clusterDag` off), its exact clusters alone, one level, each a root: the
/// mesh drawn whole at every distance. `shaping` is how the mesh keeps its shape and what its
/// finest level keeps — its layer's `meshBuild` (`HlodLayer::mesh_build`) —, kept as a primitive's
/// is (`compiler/primitive/dag.rs`): the rules every solve keeps, the near-collapsed triangles
/// dropped or not, then the finest detail cut away (`dag::cut_finest`). Its frames are kept as
/// made (`InputRules::as_made`): an HLOD builder's mesh, or an object's own level 0, already built.
fn build(
    (positions, carried, indices): (Vec<f32>, Vec<Attribute>, Vec<u32>),
    (builder, dag, shaping): (&Builder, bool, &MeshShaping),
) -> Result<Built> {
    let strategy = match dag {
        true => DagStrategy::QemEndpoints,
        false => DagStrategy::ExactClusters,
    };
    let settings = DagSettings {
        strategy,
        rules: shaping.rules(),
        drop_near_collapsed: shaping.drop_near_collapsed,
        input: InputRules::as_made(),
    };
    let refs: Vec<&Attribute> = carried.iter().collect();
    let attributes = DagAttributes { carried: &refs };
    let DagBuild {
        mut clusters,
        mut groups,
        grown,
        indices: level0,
        ..
    } = build_dag(
        &positions,
        attributes,
        &indices,
        settings,
        builder.checkpoint,
    )?;
    let (positions, carried) = grown.map_or((positions, carried), |g| (g.positions, g.carried));
    let extents = crate::dag::cut_finest(
        shaping.trim,
        (&mut clusters, &mut groups),
        &positions,
        &level0,
    );
    Ok(((clusters, groups), positions, carried, extents))
}

/// What an actor wears: its own flattened material's images and whether it draws both faces
/// (`flatten::Atlas::double_sided`), or — a merged layer's section, a voxel actor — a material of
/// the scene, its glTF rank, none for glTF's default.
pub(crate) enum Wears {
    Flattened {
        images: Vec<Image>,
        double_sided: bool,
        /// Whether every source it flattens wears a sky material (`Builder::sky`): its material is one.
        sky: bool,
    },
    Merged(Option<u64>),
}

/// One actor the chain builds: the cell its sources stream in (a rank of the chain,
/// `HlodNode`; the actor's level is that cell's `actor_level`), its build and what it wears.
pub(crate) struct Actor {
    pub cell: usize,
    pub built: Built,
    pub wears: Wears,
    /// Its mesh's triangles before its DAG simplifies them; none for a voxel actor, whose voxels
    /// and bricks its pages count (`Measures::voxels`).
    pub triangles: usize,
    /// A voxel actor's page per cluster of its build (`voxels.rs`); none for a mesh's.
    pub voxels: Vec<crate::voxel::VoxelPage>,
    /// The distance field of its cell's actors, on the first of them, when its layer allows one
    /// (`allowDistanceField`, `fields.rs`); `stage_world_roots` hands it on.
    pub field: Option<crate::distance_field::Placed>,
    /// The cards of its cell's actors, on the first of them, built with the field
    /// (`fields.rs`); `stage_world_roots` hands them on.
    pub cards: Option<crate::card_representation::PlacedCards>,
}

impl Actor {
    /// Its flattened material's images; none when it wears a material of the scene.
    pub(crate) fn images(&self) -> &[Image] {
        match &self.wears {
            Wears::Flattened { images, .. } => images,
            Wears::Merged(_) => &[],
        }
    }
}

/// The steps an actor's making is timed by, as the job's measures name them: the shell's
/// (`flatten::step`), then the merge of a merged layer's sources, the DAG build, the images' cook,
/// a voxel layer's whole job and the distance field of a cell's actors.
const STEPS: [&str; STEP_COUNT] = [
    "field",
    "march",
    "close",
    "simplify",
    "unwrap",
    "bake",
    "merge",
    "dag",
    "cook",
    "voxel",
    "distanceField",
];
const STEP_COUNT: usize = step::COUNT + 5;
const MERGE: usize = step::COUNT;
const DAG: usize = step::COUNT + 1;
const COOK: usize = step::COUNT + 2;
const VOXEL: usize = step::COUNT + 3;
const DISTANCE_FIELD: usize = step::COUNT + 4;

/// The milliseconds of each step (`STEPS`).
type StepMs = [u64; STEP_COUNT];

/// What making one actor measured: its shell's triangles after each step, the milliseconds
/// of each step and, a flattened actor, the gap between the tone its bake read and the one its
/// atlas holds (`flatten::tone_gap`).
#[derive(Clone, Copy, Default)]
struct Spent {
    pub(crate) stages: crate::hlod::flatten::Stages,
    pub(crate) ms: StepMs,
    pub(crate) tone_gap: Option<[f64; 2]>,
}

/// Whether the objects `members` of `instances` all wear a sky material (`Builder::sky`): the
/// actor flattening them wears one; a cell holding a plain material too has a plain actor.
fn all_sky(sky: &[bool], instances: &[Instance], members: &[usize]) -> bool {
    !members.is_empty()
        && (members.iter()).all(|&i| {
            let rank = instances[i].material;
            rank.is_some_and(|rank| sky.get(rank as usize).copied().unwrap_or(false))
        })
}

/// The flat mesh's build — its DAG when `hlod`'s `clusterDag` asks it, built as its `meshBuild`
/// says (`build`) — and the actor of cell `cell` around it, its atlas cooked into its images and
/// let go; what its DAG build and its images' cook took added to `spent`.
fn actor(
    (cell, hlod, sky): (usize, &crate::HlodLayer, bool),
    (flat, atlas): (crate::hlod::flatten::Flat, crate::hlod::flatten::Atlas),
    (builder, spent): (&Builder, &mut Spent),
) -> Result<Actor> {
    let triangles = flat.indices.len() / 3;
    let mut carried = vec![
        Attribute {
            flag: FLAG_NORMAL,
            width: 3,
            values: flat.normals,
        },
        Attribute {
            flag: FLAG_UV,
            width: 2,
            values: flat.uvs,
        },
    ];
    // A shell's tangents, the frame its normal map is baked in; a merged mesh stores none.
    if !flat.tangents.is_empty() {
        carried.push(Attribute {
            flag: FLAG_TANGENT,
            width: 4,
            values: flat.tangents,
        });
    }
    // A simplified shell's colours, where its layer carries its sources' onto it.
    if !flat.colours.is_empty() {
        carried.push(Attribute {
            flag: FLAG_COLOR,
            width: 4,
            values: flat.colours,
        });
    }
    let geometry = (flat.positions, carried, flat.indices);
    let flat_mesh = (&geometry.0[..], &geometry.2[..], atlas.double_sided);
    let (field, cards) = fields::mesh_fields((cell, hlod), flat_mesh, (builder, &mut *spent))?;
    let shaping = (builder, hlod.cluster_dag, &hlod.mesh_build.shaping);
    let built = timed(&mut spent.ms[DAG], || build(geometry, shaping))?;
    spent.tone_gap = Some(crate::hlod::flatten::tone_gap(atlas.tone));
    let double_sided = atlas.double_sided;
    let images = timed(&mut spent.ms[COOK], || images(builder.o, atlas))?;
    Ok(Actor {
        cell,
        built,
        wears: Wears::Flattened {
            images,
            double_sided,
            sky,
        },
        triangles,
        voxels: Vec::new(),
        field,
        cards,
    })
}

/// What a cell's job made: its actors, or why none could be made, and what its making measured.
struct Job {
    pub(crate) made: std::result::Result<Vec<Actor>, &'static str>,
    spent: Spent,
}
