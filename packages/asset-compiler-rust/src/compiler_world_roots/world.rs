//! The world's HLOD builds (`merge.rs` splices them), per cell of the layer below its actors, each
//! a mesh wearing a material (`Wears`, `flatten.rs`), built into its own DAG as any
//! primitive's (`dag::build_dag`): the same clustering, grouping, simplification and monotone
//! error, raised by how far the actor lies from its sources.
//!
//! - an approximated or proxy layer (`flatten::Shell`): at HLOD 1 per HLOD 0 cell its objects,
//!   above it per cell of the layer below the actors under it, remeshed into a closed shell, the
//!   materials of the objects under it read onto it (`flatten::built`);
//! - a merged layer (`flatten::mesh_merge`): at HLOD 1 per HLOD 0 cell its objects at the LOD its
//!   deviation selects, above it the child actors' meshes as they are drawn, merged as they are —
//!   one actor per material, each wearing a material of the scene or a child's flattened one, or,
//!   its materials merged, one actor wearing its own;
//! - a voxel layer (`voxels.rs`): per cell its objects voxelized together, levels of bricks with
//!   no shell nor atlas, above HLOD 1 its children's levels.
//!
//! Every cell's actors are one job of a single graph (`compiler_budget::admission`): a cell's job
//! starts once the jobs of the cells below it are done — no barrier between layers —, estimated
//! from what they made (`working_bytes`, `merged_bytes`), the widest first, as many at once as the
//! process's resident memory admits. The jobs come back in cell order, the order the layers and
//! their cells always ranked the actors in, whatever order they ran in.
//! The actors' builds live in `actors`, the measures in `measures`, the world's graph in `schedule`.
use super::flatten::{self, step, Library};
use super::*;
use crate::compiler_budget::admission::Done;
use crate::compiler_tables::partition::grid::hlod_grid;
use crate::dag::{build_dag, DagAttributes, DagBuild, DagCluster, DagGroup, DagStrategy};
use crate::Hlod;
use flatten::mesh_merge::{self, Material};
use flatten::publish::{images, Image};
use std::sync::Mutex;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_NORMAL, FLAG_UV};
mod actors;
mod measures;
mod schedule;
pub(crate) use measures::{Failure, Measures};
pub(super) use schedule::world_dag;

/// A world build: its clusters and groups, and the positions and attributes they index.
type Built = ((Vec<DagCluster>, Vec<DagGroup>), Vec<f32>, Vec<Attribute>);

/// What builds the world: the job's cancel check, the source materials, the job, its HLOD and the
/// bytes the process may hold resident while the actors are made (`Room::Measured`).
pub(crate) struct Builder<'a> {
    pub checkpoint: &'a (dyn Fn() -> Result<()> + Sync),
    pub library: &'a Library,
    pub o: &'a Options,
    pub hlod: &'a Hlod,
    pub room: usize,
}

/// One build of `positions`, `carried` and `indices`: the DAG, its groups and the arrays its
/// clusters index — the actor's, followed by every vertex the DAG's solves placed (`Grown`). Never
/// exact clusters: a job of them builds no HLOD (`stage_world_roots`).
fn build(
    (positions, carried, indices): (Vec<f32>, Vec<Attribute>, Vec<u32>),
    builder: &Builder,
) -> Result<Built> {
    let refs: Vec<&Attribute> = carried.iter().collect();
    let attributes = DagAttributes { carried: &refs };
    let DagBuild {
        clusters,
        groups,
        grown,
        ..
    } = build_dag(
        &positions,
        attributes,
        &indices,
        DagStrategy::QemEndpoints,
        builder.checkpoint,
    )?;
    let (positions, carried) = grown.map_or((positions, carried), |g| (g.positions, g.carried));
    Ok(((clusters, groups), positions, carried))
}

/// What an actor wears: its own flattened material's images, or — a merged layer's section — a
/// material of the scene or another actor's flattened material (`mesh_merge::Material`).
pub(crate) enum Wears {
    Flattened(Vec<Image>),
    Merged(Material),
}

/// One actor of the chain above HLOD 0: the cell its sources stream in (a rank of the chain,
/// `HlodNode`; the actor's level is that cell's `actor_level`), its build and what it wears.
pub(crate) struct Actor {
    pub cell: usize,
    pub built: Built,
    pub wears: Wears,
    /// Its flattened material's atlas, kept when a merged layer above may read it
    /// (`sources::atlas_surface`), taken by the merged-materials job that reads it last
    /// (`take_worn`), dropped once the graph is done.
    pub atlas: Mutex<Option<flatten::Atlas>>,
    /// Its mesh's triangles before its DAG simplifies them; a voxel actor's voxels.
    pub triangles: usize,
    /// A voxel actor's page per cluster of its build (`voxels.rs`); none for a mesh's.
    pub voxels: Vec<crate::voxel::VoxelPage>,
    /// A voxel actor's levels, kept for a voxel layer above, which reads them, until the graph is
    /// done.
    pub levels: Option<Vec<crate::voxel::VoxelLevel>>,
}

impl Actor {
    /// Its flattened material's images; none when it wears another's material.
    pub(crate) fn images(&self) -> &[Image] {
        match &self.wears {
            Wears::Flattened(images) => images,
            Wears::Merged(_) => &[],
        }
    }

    /// What a parent merging it wears where it is: the material it wears, its own flattened one
    /// named by its `id` (`actor_id`).
    fn material(&self, id: usize) -> Material {
        match self.wears {
            Wears::Flattened(_) => Material::Actor(id),
            Wears::Merged(material) => material,
        }
    }

    /// Its mesh at LOD 0 in world space: its build's level 0, with every attribute it carries.
    fn geometry(&self) -> mesh_merge::Geometry {
        let ((clusters, _), positions, carried) = &self.built;
        let refs: Vec<&Attribute> = carried.iter().collect();
        super::cover::level0(clusters, (positions, &refs))
    }
}

/// The actors one job may make: a merged cell's sections, at most.
const ACTORS_PER_JOB: usize = 1 << 24;

/// The name actor `k` of job `job` goes by while the graph runs, before every job's actors are
/// counted: ordered as the actors' ranks are, so a merged layer's sections come out the same
/// (`mesh_merge::merged_children`), and turned into the rank once all are done (`world_dag`).
fn actor_id(job: usize, k: usize) -> usize {
    job * ACTORS_PER_JOB + k
}

/// The distance HLOD `level`'s actor is first drawn at: the loading range of the level below,
/// past which its source cell is hidden: the actor stands in from exactly where its sources go.
pub(super) fn min_visible(level: usize) -> f64 {
    hlod_grid(level - 1).1
}

/// The steps an actor's making is timed by, as the job's measures name them: the shell's
/// (`flatten::step`), then the merge of a merged layer's sources, the DAG build and the images'
/// cook.
const STEPS: [&str; STEP_COUNT] = [
    "field", "march", "close", "simplify", "unwrap", "bake", "merge", "dag", "cook",
];
const STEP_COUNT: usize = step::COUNT + 3;
const MERGE: usize = step::COUNT;
const DAG: usize = step::COUNT + 1;
const COOK: usize = step::COUNT + 2;

/// The milliseconds of each step (`STEPS`).
type StepMs = [u64; STEP_COUNT];

/// What making one actor measured: its shell's triangles after each step, the milliseconds
/// of each step and, a flattened actor, the gap between the tone its bake read and the one its
/// atlas holds (`flatten::tone_gap`).
#[derive(Clone, Copy, Default)]
struct Spent {
    stages: flatten::Stages,
    ms: StepMs,
    tone_gap: Option<[f64; 2]>,
}

/// The flat mesh's build and the actor around it, its atlas kept when a merged layer above may
/// read it (`keep`); what its DAG build and its images' cook took added to `spent`.
fn actor(
    cell: usize,
    (flat, atlas): (flatten::Flat, flatten::Atlas),
    keep: bool,
    (builder, spent): (&Builder, &mut Spent),
) -> Result<Actor> {
    let triangles = flat.indices.len() / 3;
    let carried = vec![
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
    let started = std::time::Instant::now();
    let built = build((flat.positions, carried, flat.indices), builder)?;
    spent.ms[DAG] += flatten::millis(started);
    spent.tone_gap = Some(flatten::tone_gap(atlas.tone));
    let started = std::time::Instant::now();
    let (images, atlas) = images(builder.o, atlas)?;
    spent.ms[COOK] += flatten::millis(started);
    Ok(Actor {
        cell,
        built,
        wears: Wears::Flattened(images),
        atlas: Mutex::new(keep.then_some(atlas)),
        triangles,
        voxels: Vec::new(),
        levels: None,
    })
}

/// What a cell's job made: its actors, or why none could be made, and what its making measured.
struct Job {
    made: std::result::Result<Vec<Actor>, &'static str>,
    spent: Spent,
}

/// The actor `id` names (`actor_id`), made by a job done.
fn actor_by<'a>(done: &'a Done<Job>, id: usize) -> &'a Actor {
    let made = done.get(id / ACTORS_PER_JOB).made.as_ref();
    &made.expect("an actor named is made")[id % ACTORS_PER_JOB]
}

/// The actors of the jobs `inputs`, each by its id: the child actors a merged job merges.
fn children_of<'a>(inputs: &[usize], done: &'a Done<Job>) -> Vec<(usize, &'a Actor)> {
    (inputs.iter())
        .flat_map(|&child| match &done.get(child).made {
            Ok(actors) => (actors.iter().enumerate())
                .map(|(k, actor)| (actor_id(child, k), actor))
                .collect(),
            Err(_) => Vec::new(),
        })
        .collect()
}

/// `mutex` locked, whatever a panicking holder left in it.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
