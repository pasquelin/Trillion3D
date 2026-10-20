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
use super::flatten::{self, step, Library, Recipe, Shell};
use super::merge::WorldDag;
use super::pages::encode_pages;
use super::place::{conform, empty, gather};
use super::voxels;
use super::*;
use crate::compiler_budget::admission::{run_admitted, Done, Room};
use crate::compiler_tables::partition::{grid::hlod_grid, HlodNode};
use crate::dag::{build_dag, DagAttributes, DagBuild, DagCluster, DagGroup, DagStrategy};
use crate::{Hlod, HlodBuilder, HlodLayer};
use flatten::mesh_merge::{self, Material};
use flatten::publish::{images, Image};
use std::sync::Mutex;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_NORMAL, FLAG_UV};

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

/// The id of each actor whose flattened material one of `children` wears: the child itself, or
/// the actor it wears.
fn worn<'a>(children: &'a [(usize, &'a Actor)]) -> impl Iterator<Item = usize> + 'a {
    (children.iter()).filter_map(|&(id, actor)| match actor.material(id) {
        Material::Actor(worn) => Some(worn),
        Material::Source(_) => None,
    })
}

/// The side of each atlas one of `children` wears that is still kept (`worn`).
fn worn_sizes(children: &[(usize, &Actor)], done: &Done<Job>) -> Vec<usize> {
    let mut ids: Vec<usize> = worn(children).collect();
    ids.sort_unstable();
    ids.dedup();
    (ids.into_iter())
        .filter_map(|id| {
            lock(&actor_by(done, id).atlas)
                .as_ref()
                .map(|atlas| atlas.size)
        })
        .collect()
}

/// The atlas of each actor one of `children` wears (`worn`), by its id, taken from it: read by a
/// job that merges its materials, its last reader — that job's actor wears its own flattened
/// material, so no layer above reads the atlases under it again.
fn take_worn(children: &[(usize, &Actor)], done: &Done<Job>) -> BTreeMap<usize, flatten::Atlas> {
    let mut atlases = BTreeMap::new();
    for id in worn(children) {
        if !atlases.contains_key(&id) {
            if let Some(atlas) = lock(&actor_by(done, id).atlas).take() {
                atlases.insert(id, atlas);
            }
        }
    }
    atlases
}

/// Whether the layer `above` reads remeshes the actors under it into a shell: it then reads their
/// closed meshes (`flatten::Placed`).
fn remeshes(above: Option<HlodBuilder>) -> bool {
    above.is_some_and(|b| matches!(Recipe::of(b), Recipe::Shell(_)))
}

/// The actor of cell `cell` wearing its own flattened material that `made` holds, its atlas kept
/// when the layer above merges (`above`), and its closed mesh when the layer above remeshes;
/// `Err` with the reason it could not be made.
fn flattened_actor(
    cell: usize,
    made: flatten::Built,
    above: Option<HlodBuilder>,
    (builder, mut spent): (&Builder, Spent),
) -> Result<(Job, Vec<flatten::Placed>)> {
    let made = match made {
        Ok(made) => made,
        Err((reason, stages)) => {
            spent.stages = stages;
            return Ok((
                Job {
                    made: Err(reason),
                    spent,
                },
                Vec::new(),
            ));
        }
    };
    (builder.checkpoint)()?;
    spent.stages = made.stages;
    spent.ms[..step::COUNT]
        .iter_mut()
        .zip(made.stage_ms)
        .for_each(|(total, ms)| *total += ms);
    let closed = if remeshes(above) {
        vec![made.closed]
    } else {
        Vec::new()
    };
    let keep = above == Some(HlodBuilder::Merge);
    let actor = actor(cell, (made.flat, made.atlas), keep, (builder, &mut spent))?;
    Ok((
        Job {
            made: Ok(vec![actor]),
            spent,
        },
        closed,
    ))
}

/// The actor `shell` — layer `hlod` — makes of cell `cell` of the level below at HLOD `level`: the
/// shell of the cell's objects at HLOD 1, above it of the closed meshes `below` of the actors
/// under it — each layer simplifies the one below rather than the full sources —, the materials of
/// `members`, the instances under it, read onto it: above HLOD 1 only those the level may show
/// (`traced`). `above` is the builder of the layer that reads it.
fn approximated_actor(
    instances: &[Instance],
    (level, cell): (usize, usize),
    (shell, hlod, above): (Shell, &HlodLayer, Option<HlodBuilder>),
    (members, below): (&[usize], &[flatten::Placed]),
    builder: &Builder,
) -> Result<(Job, Vec<flatten::Placed>)> {
    let object = |i: usize| (instances[i].material, gather(&instances[i]));
    // At HLOD 1 the objects placed once are the shell's input and the bake's sources; above it the
    // shell closes the meshes below, and the objects are placed once it stands, dropped once
    // traced.
    let objects: Option<Vec<flatten::Object>> =
        (level == 1).then(|| members.iter().map(|&i| object(i)).collect());
    let meshes: Vec<flatten::Mesh> = match &objects {
        Some(objects) => (objects.iter())
            .map(|(_, (positions, _, indices))| (&positions[..], &indices[..]))
            .collect(),
        None => (below.iter())
            .map(|(positions, indices)| (&positions[..], &indices[..]))
            .collect(),
    };
    if meshes.is_empty() {
        let job = Job {
            made: Err("no mesh under the shell"),
            spent: Spent::default(),
        };
        return Ok((job, Vec::new()));
    }
    let sources = || match &objects {
        Some(objects) => std::borrow::Cow::Borrowed(&objects[..]),
        None => std::borrow::Cow::Owned(
            (members.iter())
                .filter(|&&i| traced(&instances[i], level))
                .map(|&i| object(i))
                .collect(),
        ),
    };
    let made = flatten::built(
        (shell, hlod),
        &meshes,
        (sources, builder.library),
        min_visible(level),
    );
    flattened_actor(cell, made, above, (builder, Spent::default()))
}

/// Merged layer `hlod`'s actors of cell `cell` of the level below at HLOD `level`
/// (`flatten::mesh_merge`): at HLOD 1 the objects `members` at the LOD the layer selects, above it
/// the child actors `children`, each by its id (`actor_id`), at LOD 0 wearing what they wear,
/// merged, nothing more. One actor per section, each wearing its material, the first holding the
/// merged mesh when the layer above remeshes (`above`); its materials merged (`mergeMaterials`),
/// one actor wearing its own flattened material, each section's baked into its charts
/// (`mesh_merge::merged_flat`), a child's read from the atlas of the actor that wears it
/// (`atlases`, by id, `take_worn`).
fn merged_actors(
    instances: &[Instance],
    (level, cell): (usize, usize),
    (hlod, above): (&HlodLayer, Option<HlodBuilder>),
    (members, children, atlases): (
        &[usize],
        &[(usize, &Actor)],
        BTreeMap<usize, flatten::Atlas>,
    ),
    builder: &Builder,
) -> Result<(Job, Vec<flatten::Placed>)> {
    let mut spent = Spent::default();
    let started = std::time::Instant::now();
    let flattened = hlod.merge_materials;
    let sections = if level == 1 {
        mesh_merge::merged(instances, members, (hlod.lod_selection, flattened))
    } else {
        let pieces = (children.iter())
            .map(|&(id, actor)| (actor.material(id), actor.geometry()))
            .collect();
        mesh_merge::merged_children(pieces, flattened)
    };
    spent.ms[MERGE] = flatten::millis(started);
    let triangles: usize = sections.iter().map(|(_, (_, _, i))| i.len() / 3).sum();
    spent.stages = [triangles; flatten::STAGE_COUNT];
    if triangles == 0 {
        let job = Job {
            made: Err("the merged mesh has no triangle"),
            spent,
        };
        return Ok((job, Vec::new()));
    }
    (builder.checkpoint)()?;
    if flattened {
        let library = (builder.library, &atlases);
        let made = mesh_merge::merged_flat(&sections, library, hlod.texture_size);
        drop((sections, atlases));
        return flattened_actor(cell, made, above, (builder, spent));
    }
    let closed = if remeshes(above) {
        vec![mesh_merge::closed(&sections)]
    } else {
        Vec::new()
    };
    let mut made = Vec::with_capacity(sections.len());
    for (material, geometry) in sections {
        let triangles = geometry.2.len() / 3;
        let started = std::time::Instant::now();
        let built = build(geometry, builder)?;
        spent.ms[DAG] += flatten::millis(started);
        made.push(Actor {
            cell,
            built,
            wears: Wears::Merged(material),
            atlas: Mutex::new(None),
            triangles,
            voxels: Vec::new(),
            levels: None,
        });
    }
    let job = Job {
        made: Ok(made),
        spent,
    };
    Ok((job, closed))
}

/// The bytes merged layer `hlod`'s actors of HLOD `level` hold while they are made
/// (`mesh_merge::working_bytes`): the cuts of the objects `members` at HLOD 1, above it the child
/// actors' meshes at LOD 0 (`children`, by id), when their materials are merged their atlas cooked
/// for `families` block families and the surface of each atlas a section may wear (`atlases`, their
/// sides, `sources::atlas_surface_bytes`).
fn merged_bytes(
    instances: &[Instance],
    (level, hlod, families): (usize, &HlodLayer, usize),
    (members, children, atlases): (&[usize], &[(usize, &Actor)], &[usize]),
) -> usize {
    let pieces = if level == 1 {
        mesh_merge::cut_bytes(instances, members, hlod.lod_selection)
    } else {
        (children.iter()).fold((0, 0), |(bytes, corners), &(_, actor)| {
            let ((clusters, _), positions, _) = &actor.built;
            let level0: usize = (clusters.iter().filter(|c| c.level == 0))
                .map(|c| c.indices.len())
                .sum();
            let held = mesh_merge::mesh_bytes(positions.len() / 3, level0);
            (bytes + held, corners + level0)
        })
    };
    if !hlod.merge_materials {
        return mesh_merge::working_bytes(pieces, None);
    }
    // Each atlas a section may wear, read as a surface.
    let surfaces: usize = (atlases.iter())
        .map(|&size| flatten::sources::atlas_surface_bytes(size))
        .sum();
    mesh_merge::working_bytes(pieces, Some((hlod.texture_size, families))).saturating_add(surfaces)
}

/// `instance`'s box in world space: its cover's box placed by its matrix.
fn world_box(instance: &Instance) -> ([f64; 3], [f64; 3]) {
    use trillion3d_math::box_transform::box_transform;
    use trillion3d_page_codec::proxy::bvh::extent;
    let mut world = [0.0; 6];
    box_transform(
        &mut world,
        &extent(&instance.cover.positions),
        &instance.matrix,
    );
    (
        [world[0], world[1], world[2]],
        [world[3], world[4], world[5]],
    )
}

/// Whether HLOD `level`'s bake traces `instance`: every object at HLOD 1, whose shell it also
/// makes; above it, one whose box in world space (`world_box`) spans at least a pixel where the
/// level is first seen (`min_visible`, `flatten::pixel_at`) — a smaller one shows in no texel
/// there, and the shell it bakes onto is the layer below's, not the objects'.
fn traced(instance: &Instance, level: usize) -> bool {
    if level == 1 {
        return true;
    }
    let (low, high) = world_box(instance);
    let diagonal = trillion3d_math::aabb::diagonal(low, high);
    // A box no matrix places (not a number) is traced, as an object of unknown size.
    diagonal.is_nan() || diagonal >= flatten::pixel_at(min_visible(level))
}

/// The faces of the solid a source face makes, at most: a thin part thickened shows two
/// (`approximate::scene`).
const FACES: f64 = 2.0;

/// The bytes the actor `shell` — layer `hlod` — of HLOD `level` of the objects `members` holds
/// while it is made (`flatten::working_bytes`): the triangles the bake traces — the objects' it
/// traces (`traced`) — and
/// those the shell approximates — the objects' again at HLOD 1, the `below` triangles of the closed
/// meshes of the actors under it above it —, within the objects' bounds in world space, the skin
/// of their solid, its images cooked for `families` block families.
///
/// The skin is the area the solid's surface shows the grid's three axes — the cells it crosses
/// per square cell —, per object the least of two: twice the area its faces show the axes (`FACES`,
/// each triangle's area vector placed by its matrix's cofactor, `cofactor_direction`, its three
/// components' magnitudes summed), and the surface of its box in world space, which holds the
/// solid its faces close — a tower's floors, inside its walls, never reach the surface.
fn working_bytes(
    instances: &[Instance],
    (level, shell, hlod, families): (usize, Shell, &HlodLayer, usize),
    (members, below): (&[usize], usize),
) -> usize {
    use trillion3d_math::aabb::{half_area, merge_aabb};
    use trillion3d_math::linear::cofactor_direction;
    use trillion3d_math::vec3::{cross, point};
    use trillion3d_math::vecn::sub;
    let bake_triangles: usize = (members.iter())
        .filter(|&&i| traced(&instances[i], level))
        .map(|&i| instances[i].cover.indices.len() / 3)
        .sum();
    let approximated = if level == 1 { bake_triangles } else { below };
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    let mut skin = 0.0;
    for &i in members {
        let (cover, matrix) = (instances[i].cover, &instances[i].matrix);
        let axes = |n: [f64; 3]| n.iter().map(|x| x.abs()).sum::<f64>();
        let (placed, own) = (cover.indices.as_chunks::<3>().0.iter())
            .map(|t| {
                let [a, b, c] = t.map(|v| point(&cover.positions, v));
                let normal = cross(sub(b, a), sub(c, a)).map(|x| 0.5 * x);
                (axes(cofactor_direction(matrix, normal)), axes(normal))
            })
            .fold((0.0, 0.0), |(p, o), (x, y)| (p + x, o + y));
        // A matrix that is not finite places nothing: the object's own.
        let shown = if placed.is_finite() { placed } else { own };
        let (box_low, box_high) = world_box(&instances[i]);
        // A box no matrix places (not finite) widens nothing: the estimate stays bounded.
        if box_low.iter().chain(&box_high).all(|x| x.is_finite()) {
            merge_aabb(&mut low, &mut high, box_low, box_high);
        }
        let surface = 2.0 * half_area(box_low, box_high);
        let faces = FACES * shown;
        skin += if surface.is_finite() {
            faces.min(surface)
        } else {
            faces
        };
    }
    flatten::working_bytes(
        (bake_triangles + approximated, skin),
        (low, high),
        (shell, hlod, min_visible(level), families),
    )
}

/// A cell whose actor could not be made: its HLOD level, its cell and the reason.
pub(crate) type Failure = (usize, usize, &'static str);

/// What the making measured, per HLOD level from 1: each step's milliseconds summed over its
/// actors (`STEPS`), its shells' triangles after each step summed over the actors made and, apart,
/// over those that failed (`flatten::Stages`), and the most triangles one actor made holds, where
/// a crumpled shell shows; over the whole graph, the cores it kept busy — the process's CPU time
/// over its wall time — and the most estimated bytes it ran at once over the growth of the
/// process's resident bytes — above one, the estimates leave cores idle; below, the memory passes
/// what they promised (`compiler_budget::admission::Admitted`).
#[derive(Default)]
pub(crate) struct Measures {
    pub step_ms: Vec<StepMs>,
    pub stages: Vec<flatten::Stages>,
    pub failed_stages: Vec<flatten::Stages>,
    pub most_triangles: Vec<usize>,
    /// Per level, the mean tone gap of its flattened actors (`Spent`); none without one.
    pub tone_gap: Vec<Option<[f64; 2]>>,
    pub parallelism: Option<f64>,
    pub estimate_over_peak: Option<f64>,
}

impl Measures {
    /// Each step's milliseconds per level, by its name (`STEPS`).
    pub(crate) fn steps(&self) -> Value {
        let named = (STEPS.iter().enumerate()).map(|(k, name)| {
            (
                name.to_string(),
                json!(self.step_ms.iter().map(|ms| ms[k]).collect::<Vec<_>>()),
            )
        });
        Value::Object(named.collect())
    }
}

/// The world DAG of `instances` over the chain `tree` (`HlodNode`, leaves first), its actors and
/// the cells whose actor could not be made: per cell whose actor a job layer builds
/// (`HlodNode::actor_layer`), that layer's actors — HLOD 1 per HLOD 0 cell, then each next level up
/// to each chain's top, a short chain's top built once more on the `TOP_LEVEL` grid —, a cell of
/// objects in no layer building none; the clusters of actor `k` wear what it wears (`Wears`), and
/// name `k`. In culling order, its pages written; with what the making measured.
pub(super) fn world_dag(
    instances: &[Instance],
    tree: &[HlodNode],
    builder: &Builder,
) -> Result<(WorldDag, Vec<Actor>, Vec<Failure>, Measures)> {
    let started = std::time::Instant::now();
    let cpu = crate::perf::rss::cpu_ms();
    let layers = &builder.hlod.layers;
    // The job layer that builds the actor of cell `cell`; none for a cell of objects in no layer.
    let built_by = |cell: usize| tree[cell].actor_layer(builder.hlod).map(|p| &layers[p]);
    // The builder of the layer that reads cell `cell`'s actors.
    let above = |cell: usize| {
        tree[cell]
            .parent
            .and_then(built_by)
            .map(|layer| layer.builder)
    };
    // Each cell's members — the instances under it — at every level at once, by cell: the chain
    // lists each level's cells after the level below's, so the cells' order is the layers'.
    let mut members: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (i, instance) in instances.iter().enumerate() {
        if instance.cover.indices.is_empty() {
            continue;
        }
        let mut cell = Some(instance.hlod);
        while let Some(at) = cell {
            if built_by(at).is_some() {
                members.entry(at).or_default().push(i);
            }
            cell = tree[at].parent;
        }
    }
    let jobs: Vec<(usize, Vec<usize>)> = members.into_iter().collect();
    let job_of: BTreeMap<usize, usize> = (jobs.iter().enumerate())
        .map(|(job, &(cell, _))| (cell, job))
        .collect();
    // Each job's inputs: the jobs of the cells right below its cell, in order.
    let mut inputs: Vec<Vec<usize>> = vec![Vec::new(); jobs.len()];
    for (job, &(cell, _)) in jobs.iter().enumerate() {
        if let Some(&parent) = tree[cell].parent.and_then(|p| job_of.get(&p)) {
            inputs[parent].push(job);
        }
    }
    // The closed meshes each job leaves the layer above, taken by the job that reads them.
    let closed: Vec<Mutex<Vec<flatten::Placed>>> =
        (0..jobs.len()).map(|_| Mutex::new(Vec::new())).collect();
    // A child that closed no mesh — its actor failed — leaves its own objects in its place, as at
    // HLOD 1: the shell above never stands with a hole where it was.
    let below_of = |child: usize| -> Vec<flatten::Placed> {
        let left = std::mem::take(&mut *lock(&closed[child]));
        if !left.is_empty() {
            return left;
        }
        (jobs[child].1.iter())
            .map(|&i| {
                let (positions, _, indices) = gather(&instances[i]);
                (positions, indices)
            })
            .collect()
    };
    let families = builder.o.texture_formats.len();
    // The objects of a voxel job no child actor stands for: every member at HLOD 1, above it those
    // of the children whose actor failed — or that were never made.
    let orphans_of = |job: usize, done: &Done<Job>| -> Vec<usize> {
        if inputs[job].is_empty() {
            return jobs[job].1.clone();
        }
        let covered: BTreeSet<usize> = (inputs[job].iter())
            .filter(|&&child| done.get(child).made.is_ok())
            .flat_map(|&child| jobs[child].1.iter().copied())
            .collect();
        (jobs[job].1.iter())
            .filter(|i| !covered.contains(i))
            .copied()
            .collect()
    };
    let hlod_of = |job: usize| built_by(jobs[job].0).expect("a cell whose layer builds actors");
    let level_of = |job: usize| tree[jobs[job].0].actor_level();
    let estimate = |job: usize, done: &Done<Job>| {
        let (hlod, members) = (hlod_of(job), jobs[job].1.as_slice());
        match Recipe::of(hlod.builder) {
            Recipe::Voxel => voxels::working_bytes(instances, &orphans_of(job, done)),
            Recipe::Shell(shell) => {
                let below: usize = (inputs[job].iter())
                    .map(|&child| {
                        let held = lock(&closed[child]);
                        if held.is_empty() {
                            // Its own objects stand in for a child that closed no mesh.
                            let objects = jobs[child].1.iter();
                            return objects
                                .map(|&i| instances[i].cover.indices.len() / 3)
                                .sum::<usize>();
                        }
                        held.iter()
                            .map(|(_, indices)| indices.len() / 3)
                            .sum::<usize>()
                    })
                    .sum();
                let on = (level_of(job), shell, hlod, families);
                working_bytes(instances, on, (members, below))
            }
            Recipe::Merge => {
                let children = children_of(&inputs[job], done);
                let atlases = worn_sizes(&children, done);
                let on = (level_of(job), hlod, families);
                merged_bytes(instances, on, (members, &children, &atlases))
            }
        }
    };
    let make = |job: usize, done: &Done<Job>| -> Result<Job> {
        (builder.checkpoint)()?;
        let (cell, members) = (jobs[job].0, jobs[job].1.as_slice());
        let (hlod, level, above) = (hlod_of(job), level_of(job), above(cell));
        let (made, left) = match Recipe::of(hlod.builder) {
            Recipe::Voxel => {
                let children: Vec<&Actor> = (children_of(&inputs[job], done).into_iter())
                    .map(|(_, actor)| actor)
                    .collect();
                let orphans = orphans_of(job, done);
                let on = (members, children.as_slice(), orphans.as_slice());
                let library = (builder.library, builder.checkpoint);
                let made = voxels::voxel_actor(instances, (level, cell), on, library)?;
                let made = made.map(|actor| vec![actor]);
                (
                    Job {
                        made,
                        spent: Spent::default(),
                    },
                    Vec::new(),
                )
            }
            Recipe::Shell(shell) => {
                let below: Vec<flatten::Placed> =
                    inputs[job].iter().flat_map(|&c| below_of(c)).collect();
                let on = (shell, hlod, above);
                approximated_actor(instances, (level, cell), on, (members, &below), builder)?
            }
            Recipe::Merge => {
                let children = children_of(&inputs[job], done);
                // Only a job that merges its materials reads its children's atlases.
                let atlases = if hlod.merge_materials {
                    take_worn(&children, done)
                } else {
                    BTreeMap::new()
                };
                let merged = (members, children.as_slice(), atlases);
                merged_actors(instances, (level, cell), (hlod, above), merged, builder)?
            }
        };
        *lock(&closed[job]) = left;
        Ok(made)
    };
    let (made, admitted) = run_admitted(&inputs, Room::Measured(builder.room), estimate, make)?;
    // Every job's actors ranked in the jobs' order, their ids turned into those ranks.
    let mut first = Vec::with_capacity(made.len());
    let mut count = 0;
    for job in &made {
        first.push(count);
        count += job.made.as_ref().map_or(0, Vec::len);
    }
    let rank = |id: usize| first[id / ACTORS_PER_JOB] + id % ACTORS_PER_JOB;
    let levels = tree.iter().map(HlodNode::actor_level).max().unwrap_or(0);
    let mut measures = Measures {
        step_ms: vec![[0; STEP_COUNT]; levels],
        stages: vec![[0; flatten::STAGE_COUNT]; levels],
        failed_stages: vec![[0; flatten::STAGE_COUNT]; levels],
        most_triangles: vec![0; levels],
        ..Measures::default()
    };
    let mut tone_gaps = vec![([0.0; 2], 0usize); levels];
    let (mut actors, mut failures) = (Vec::with_capacity(count), Vec::new());
    for (job, Job { made, spent }) in made.into_iter().enumerate() {
        let (cell, level) = (jobs[job].0, level_of(job));
        let at = level - 1;
        let stages = match made {
            Ok(made) => {
                for mut actor in made {
                    // No layer reads an atlas, nor a voxel actor's levels, once the graph is done.
                    *actor.atlas.get_mut().unwrap_or_else(|e| e.into_inner()) = None;
                    actor.levels = None;
                    if let Wears::Merged(Material::Actor(id)) = actor.wears {
                        actor.wears = Wears::Merged(Material::Actor(rank(id)));
                    }
                    measures.most_triangles[at] = measures.most_triangles[at].max(actor.triangles);
                    actors.push(actor);
                }
                &mut measures.stages[at]
            }
            Err(reason) => {
                failures.push((level, cell, reason));
                &mut measures.failed_stages[at]
            }
        };
        stages
            .iter_mut()
            .zip(spent.stages)
            .for_each(|(total, step)| *total += step);
        if let Some([luminance, hue]) = spent.tone_gap {
            let (sum, count) = &mut tone_gaps[at];
            *sum = [sum[0] + luminance, sum[1] + hue];
            *count += 1;
        }
        (measures.step_ms[at].iter_mut())
            .zip(spent.ms)
            .for_each(|(total, ms)| *total += ms);
    }
    measures.tone_gap = (tone_gaps.into_iter())
        .map(|(sum, count)| (count > 0).then(|| sum.map(|total| total / count as f64)))
        .collect();
    let wall = crate::shared_math::elapsed_ms(started);
    let spent = crate::perf::rss::cpu_ms()
        .zip(cpu)
        .map(|(now, then)| now - then);
    measures.parallelism = spent.map(|cpu| cpu / wall.max(1.0));
    measures.estimate_over_peak = (admitted.measured)
        .filter(|&measured| measured > 0.0)
        .map(|measured| 1.0 / measured);
    // Every attribute an actor carries: a flattened actor its normals and atlas coordinates, a
    // merged one the texture sets of its sources (`mesh_merge::sections`).
    let layout = (actors.iter())
        .flat_map(|actor| actor.built.2.iter().map(|a| a.flag))
        .fold(FLAG_NORMAL | FLAG_UV, |flags, flag| flags | flag);
    let mut world = WorldDag {
        carried: empty(layout),
        ..WorldDag::default()
    };
    for actor in actors.iter_mut() {
        let (dag, positions, carried) = std::mem::take(&mut actor.built);
        // The world's attributes on the actor's vertices, zeros for one it lacks.
        let arrays = conform(carried, layout, positions.len() / 3);
        let arrays: Vec<&Attribute> = arrays.iter().collect();
        let voxels = std::mem::take(&mut actor.voxels);
        world.splice(dag, (&positions, &arrays), (voxels, actor.cell));
    }
    world.in_culling_order();
    world.pages = encode_pages(&world)?;
    Ok((world, actors, failures, measures))
}
