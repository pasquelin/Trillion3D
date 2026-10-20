//! The voxel stage: every seeded group of every primitive tried by the voxel rule, level by level,
//! then each mesh's far group, and the groups drawn as voxels written in one product,
//! `voxels.bin`, which the manifest's `voxels` section names.
//!
//! A group's side starts at its first (`SeedGroup::first_side`) and grows by `GROWTH` until its
//! solid voxels fit the group's budget — three for every four of its children's vertices, and as
//! many bricks as its planned parents hold triangles —, as long as their error stays below its
//! triangles'. A group whose child comes from a voxel group has no triangles to beat — once a
//! level is voxels, every level above is —: it is drawn as voxels, at the side its budget allows.
//! A mesh's far group exists only above roots drawn as voxels: only a voxel root keeps coarsening
//! past the DAG's top.
//!
//! `voxels.bin`, little-endian: a head — `T3VX`, the version, the group count, the brick count —,
//! then a record per group (`GROUP_BYTES`): its primitive (`u32::MAX` for a far group), its rank
//! among the primitive's DAG groups (a far group: its compiled mesh), its first brick and brick
//! count, its first voxel and voxel count (`u32` each), its error, the error it is replaced at
//! and its voxel side (`f32`, object units), and the object position of its first brick's corner
//! (`f32` × 3); then every brick, then every voxel (`bricks.rs`). A group's voxels follow its
//! bricks in order, each brick's in its mask's bit order: a brick's first voxel is the group's
//! first plus the popcounts of the masks before it.
//!
//! A brick is replaced with the output of its group nearest it, when that output's parent is
//! drawn; a group whose outputs have parents replaced at different errors is written as one record
//! per error, sharing its rank, each with its bricks. A far group is replaced by nothing
//! (infinite) and replaces every primitive of its mesh at its error, blended ones too: far glass
//! is opaque voxels. A group keeps at least one voxel; a mesh none of whose sides keeps one has no
//! far group, its roots drawn at every distance.
use super::bricks::{brick_record, bricks, most, voxel_record, Brick, BRICK_BYTES, VOXEL_BYTES};
use super::raster::{cells, Cell};
use super::sample::{sample, Moments, Probe};
use super::seed::{SeedGroup, VoxelSeed};
use super::solid::{solid, Voxel};
use super::{ERROR_PER_SIZE, VOXEL_FILE, VOXEL_VERSION};
use crate::compiler_page_record::page_deformation;
use crate::compiler_primitive::triangles::read;
use crate::compiler_storage::{product, Product};
use crate::dag::DAG_CLUSTER_TRIANGLES;
use crate::proxy::tracer::vertex;
use crate::surface_trace::Traceable;
use crate::texture_preview::TexturePreview;
use crate::{invalid, Result};
use rayon::prelude::*;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::ops::Range;
use std::path::Path;
use trillion3d_math::vecn::sub;

/// Bytes of the head and of a group's record.
const HEAD_BYTES: usize = 16;
const GROUP_BYTES: usize = 48;

/// How much the side grows between two tries: fine enough steps that the side found sits close to
/// the budget.
const GROWTH: f64 = 1.1;

/// What the stage reads: the scene, its previews, its meshes' map, the compiled primitives and,
/// beside each, its seed.
pub(crate) struct VoxelInputs<'a> {
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub previews: &'a [TexturePreview],
    pub mesh_map: &'a BTreeMap<usize, usize>,
    pub primitives: &'a [Value],
    pub seeds: &'a [VoxelSeed],
}

/// A group drawn as voxels — of a primitive's DAG, or a mesh's far group (`primitive` `None`, `group`
/// the compiled mesh) — and, per brick, the error it is replaced at (infinite for a far group).
struct Voxelized {
    primitive: Option<usize>,
    group: usize,
    level: usize,
    triangle_error: f64,
    forced: bool,
    side: f64,
    voxels: Vec<Voxel>,
    bricks: Vec<Brick>,
    brick_parents: Vec<f64>,
}

impl Voxelized {
    fn error(&self) -> f64 {
        self.side * ERROR_PER_SIZE
    }

    /// The error its first brick is replaced at: every brick's, once `parts` split it.
    fn parent_error(&self) -> f64 {
        self.brick_parents.first().copied().unwrap_or(f64::INFINITY)
    }

    /// One group per error its bricks are replaced at, in the order they first come, each with
    /// its bricks' voxels in brick order.
    fn parts(self) -> Vec<Voxelized> {
        let mut errors: Vec<u64> = Vec::new();
        for e in &self.brick_parents {
            if !errors.contains(&e.to_bits()) {
                errors.push(e.to_bits());
            }
        }
        let part = |bits: u64| {
            let mut voxels = Vec::new();
            let mut bricks = Vec::new();
            let mine =
                (self.bricks.iter().zip(&self.brick_parents)).filter(|b| b.1.to_bits() == bits);
            for (brick, _) in mine {
                let first = voxels.len();
                voxels.extend(brick.voxels.iter().map(|&v| self.voxels[v].clone()));
                bricks.push(Brick {
                    voxels: (first..voxels.len()).collect(),
                    ..brick.clone()
                });
            }
            Voxelized {
                brick_parents: vec![f64::from_bits(bits); bricks.len()],
                voxels,
                bricks,
                ..self.clone_head()
            }
        };
        errors.into_iter().map(part).collect()
    }

    /// Its fields but its voxels, bricks and their parents.
    fn clone_head(&self) -> Voxelized {
        Voxelized {
            primitive: self.primitive,
            group: self.group,
            level: self.level,
            triangle_error: self.triangle_error,
            forced: self.forced,
            side: self.side,
            voxels: Vec::new(),
            bricks: Vec::new(),
            brick_parents: Vec::new(),
        }
    }
}

/// A mesh's groups drawn as voxels, its far group last, and the error from which it draws nothing
/// else: the largest a triangle cluster of any of its primitives is replaced at.
struct Voxelled {
    mesh: usize,
    groups: Vec<Voxelized>,
    voxels_from: f64,
}

/// Voxelizes every seeded group, then every mesh's far group, and writes `voxels.bin` in
/// `directory`; returns its product and the manifest's `voxels` section.
pub(crate) fn stage_voxels(
    inputs: &VoxelInputs<'_>,
    directory: &Path,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(Product, Value)> {
    let _t = crate::perf::Timer::new(crate::perf::Phase::Voxels);
    // A compiled mesh is read from the first source mesh it stands for.
    let mut source_of: BTreeMap<u64, usize> = BTreeMap::new();
    for (&source, &compiled) in inputs.mesh_map {
        source_of.entry(compiled as u64).or_insert(source);
    }
    let mut by_mesh: BTreeMap<(u64, usize), Vec<usize>> = BTreeMap::new();
    // A mesh none of whose primitives may be drawn as voxels has no voxel group (`seed.rs`).
    for p in (0..inputs.seeds.len()).filter(|&p| !inputs.seeds[p].groups.is_empty()) {
        let compiled = inputs.primitives[p]["mesh"].as_u64();
        if let Some((m, &source)) = compiled.and_then(|m| Some((m, source_of.get(&m)?))) {
            by_mesh.entry((m, source)).or_default().push(p);
        }
    }
    let meshes: Vec<((u64, usize), Vec<usize>)> = by_mesh.into_iter().collect();
    let done: Vec<Voxelled> = meshes
        .par_iter()
        .map(|(mesh, primitives)| voxelize_mesh(inputs, *mesh, primitives))
        .collect::<Result<_>>()?;
    let bytes = encode(&done);
    let written = product(directory, VOXEL_FILE, &bytes)?;
    let section = report(inputs, &done, bytes.len());
    progress(
        json!({"phase":"voxels","completed":1,"total":1,"groups":section["groups"],
        "bricks":section["bricks"],"voxels":section["voxels"]}),
    );
    Ok((written, section))
}

/// The groups of compiled mesh `compiled`, read from source mesh `source`, drawn as voxels: each
/// of its `primitives`' seeded groups in level order, then its far group, above every primitive's
/// roots and sampled against all its triangles, so its voxels mix its materials.
fn voxelize_mesh(
    inputs: &VoxelInputs<'_>,
    (compiled, source): (u64, usize),
    primitives: &[usize],
) -> Result<Voxelled> {
    let traceable = Traceable::read(inputs.g, inputs.bin, source, inputs.previews)?;
    let count = traceable.world.tags.len();
    let joints = mesh_joints(inputs, source, &traceable)?;
    let near = vec![0.0; count];
    let probe = Probe {
        mesh: &traceable,
        near: &near,
        tie: traceable.tie(),
    };
    let boxes: Vec<([f64; 3], [f64; 3])> = (0..count)
        .map(|t| {
            let c = [0, 1, 2].map(|k| vertex(&traceable.world, t, k));
            let low = std::array::from_fn(|k| c[0][k].min(c[1][k]).min(c[2][k]));
            let high = std::array::from_fn(|k| c[0][k].max(c[1][k]).max(c[2][k]));
            (low, high)
        })
        .collect();
    let whole = Surface {
        probe: &probe,
        range: 0..count,
        boxes: &boxes,
        joints: joints.as_deref(),
    };
    let mut groups = Vec::new();
    // Per primitive: its triangles' ranks, and the error each of its groups drawn as voxels is
    // drawn at.
    let mut lower: Vec<(usize, Range<usize>, HashMap<usize, f64>)> = Vec::new();
    for &p in primitives {
        let index = inputs.primitives[p]["primitive"].as_u64().unwrap_or(0) as usize;
        let range = (traceable.primitives.iter())
            .find(|(i, _)| *i == index)
            .map(|(_, range)| range.clone())
            .ok_or_else(|| invalid("A voxelized primitive draws no triangles"))?;
        let surface = whole.within(range.clone());
        let mut drawn: HashMap<usize, f64> = HashMap::new();
        let ruled = inputs.seeds[p]
            .groups
            .split_last()
            .map_or(&[][..], |(_, r)| r);
        for group in ruled {
            let (forced, child_error) = children_drawn(group, &drawn);
            // Triangles from a voxel group are no alternative to beat.
            let beat = match forced {
                true => f64::INFINITY,
                false => group.error,
            };
            if let Some(voxelized) = voxelize(&surface, group, child_error, beat) {
                drawn.insert(group.group, voxelized.error());
                groups.push(Voxelized {
                    primitive: Some(p),
                    forced,
                    ..voxelized
                });
            }
        }
        lower.push((p, range, drawn));
    }
    let (far, forced) = far_group(inputs, compiled as usize, &lower);
    let child_error = far.children.iter().map(|c| c.1).fold(0.0, f64::max);
    // A far group has no triangles to beat: its side grows until it fits. Its error is never
    // below its roots' — its first side is at least theirs over `ERROR_PER_SIZE` —, and where no
    // side keeps a voxel there is none: the roots are drawn at every distance. Only roots drawn
    // as voxels go on.
    let far = forced
        .then(|| voxelize(&whole, &far, child_error, f64::INFINITY))
        .flatten();
    let far_error = far.as_ref().map_or(f64::INFINITY, Voxelized::error);
    // Each primitive's roots are replaced by the far group.
    let mut voxels_from = 0.0_f64;
    for (p, _, drawn) in &mut lower {
        let seed = &inputs.seeds[*p];
        if let Some(above) = seed.groups.last().filter(|_| far.is_some()) {
            drawn.insert(above.group, far_error);
        }
        // A triangle child is replaced at its group's error, as voxels when its group is; one
        // from a voxel group is never drawn.
        let replaced = (seed.groups.iter()).flat_map(|group| {
            let at = drawn.get(&group.group).copied().unwrap_or(group.error);
            let triangles =
                (group.children.iter()).filter(|c| c.0.is_none_or(|s| !drawn.contains_key(&s)));
            triangles.map(move |_| at)
        });
        voxels_from = voxels_from.max(replaced.fold(0.0, f64::max));
        // A brick is replaced with the output nearest it, when that output's parent is drawn:
        // at its voxel error, or its triangles' as triangles, or the far group's above the roots.
        let replaced_at = |rank: usize| match seed.errors.get(rank) {
            Some(&error) => drawn.get(&rank).copied().unwrap_or(error),
            None => far_error,
        };
        for group in groups.iter_mut().filter(|g| g.primitive == Some(*p)) {
            let seeded = seed.groups.iter().find(|s| s.group == group.group);
            let parents = &seeded.expect("a voxel group is seeded").parents;
            let side = group.side;
            group.brick_parents = (group.bricks.iter())
                .map(|brick| {
                    let centre = brick.at.map(|c| (f64::from(c) * 4.0 + 2.0) * side);
                    let distance = |at: [f64; 3]| {
                        let d = sub(at, centre);
                        d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
                    };
                    let nearest =
                        (parents.iter()).min_by(|a, b| distance(a.0).total_cmp(&distance(b.0)));
                    nearest.map_or(f64::INFINITY, |&(_, rank)| replaced_at(rank))
                })
                .collect();
        }
    }
    if let Some(far) = far {
        groups.push(Voxelized {
            primitive: None,
            forced,
            ..far
        });
    }
    Ok(Voxelled {
        mesh: compiled as usize,
        groups: groups.into_iter().flat_map(Voxelized::parts).collect(),
        voxels_from,
    })
}

/// Whether a child of `group` comes from a group drawn as voxels, and the largest error its
/// children are drawn at, those at their voxel error.
fn children_drawn(group: &SeedGroup, drawn: &HashMap<usize, f64>) -> (bool, f64) {
    let voxel = |&(source, _): &(Option<usize>, f64)| source.and_then(|s| drawn.get(&s).copied());
    let forced = group.children.iter().any(|c| voxel(c).is_some());
    let error = (group.children.iter())
        .map(|c| voxel(c).unwrap_or(c.1))
        .fold(0.0, f64::max);
    (forced, error)
}

/// The far group of a mesh, from each primitive's group above its roots: their children, each at
/// the error it is drawn at — a root from a voxel group at that group's —, their area, vertices
/// and triangles, as ranks among the mesh's; and whether a root comes from a voxel group.
fn far_group(
    inputs: &VoxelInputs<'_>,
    mesh: usize,
    lower: &[(usize, Range<usize>, HashMap<usize, f64>)],
) -> (SeedGroup, bool) {
    let mut far = SeedGroup {
        group: mesh,
        level: 0,
        error: f64::INFINITY,
        children: Vec::new(),
        parents: Vec::new(),
        area: 0.0,
        vertices: 0,
        num_parents: 1,
        triangles: Vec::new(),
    };
    let mut forced = false;
    for (p, range, drawn) in lower {
        let Some(above) = inputs.seeds[*p].groups.last() else {
            continue;
        };
        far.level = far.level.max(above.level);
        far.area += above.area;
        far.vertices += above.vertices;
        let (voxel, _) = children_drawn(above, drawn);
        forced |= voxel;
        let error = |&(source, error): &(Option<usize>, f64)| {
            source.and_then(|s| drawn.get(&s).copied()).unwrap_or(error)
        };
        far.children
            .extend(above.children.iter().map(|c| (None, error(c))));
        far.triangles
            .extend(above.triangles.iter().map(|&t| range.start as u32 + t));
    }
    (far, forced)
}

/// Triangles as the voxels sample them: their ranks in the mesh's tracer, their boxes and, for a
/// skinned mesh, each one's joint (`u16::MAX` for none).
struct Surface<'a> {
    probe: &'a Probe<'a>,
    range: Range<usize>,
    boxes: &'a [([f64; 3], [f64; 3])],
    joints: Option<&'a [u16]>,
}

impl<'a> Surface<'a> {
    /// The triangles of `range` alone, a range of this surface's.
    fn within(&self, range: Range<usize>) -> Surface<'a> {
        let local = range.start - self.range.start..range.end - self.range.start;
        Surface {
            probe: self.probe,
            boxes: &self.boxes[local.clone()],
            joints: self.joints.map(|j| &j[local]),
            range,
        }
    }
}

/// `group` drawn as voxels, its children drawn at `child_error`, when a side fits its budget with
/// an error below `beat` — every side tried is sampled, not estimated: the rays drop the voxels a
/// surface only grazes, however many the triangles touch —; its triangles are ranks from the
/// start of `surface`. A side without length covers nothing, and none that keeps no voxel fits.
fn voxelize(
    surface: &Surface<'_>,
    group: &SeedGroup,
    child_error: f64,
    beat: f64,
) -> Option<Voxelized> {
    let world = &surface.probe.mesh.world;
    let start = surface.range.start;
    let corners = |t: usize| [0, 1, 2].map(|k| vertex(world, t, k));
    let budget = (
        group.target_voxels(),
        group.num_parents.max(1) * DAG_CLUSTER_TRIANGLES,
    );
    // A voxel wider than twice the triangles' extent covers no more of them than one as wide.
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for &t in &group.triangles {
        for corner in corners(start + t as usize) {
            low = std::array::from_fn(|k| low[k].min(corner[k]));
            high = std::array::from_fn(|k| high[k].max(corner[k]));
        }
    }
    let widest = 2.0 * (0..3).map(|k| high[k] - low[k]).fold(0.0, f64::max);
    let mut side = group.first_side(child_error);
    while side > 0.0 && side <= widest && side * ERROR_PER_SIZE < beat {
        let mut candidates: Vec<Cell> = Vec::new();
        for &t in &group.triangles {
            cells(corners(start + t as usize), side, |c| candidates.push(c));
        }
        candidates.sort_unstable_by_key(|c| (c[2], c[1], c[0]));
        candidates.dedup();
        let voxels = solid(sampled(surface, &candidates, side));
        let packed = bricks(&voxels);
        // No voxel left draws nothing in the triangles' place: a larger side is tried.
        if !voxels.is_empty() && voxels.len() <= budget.0 && packed.len() <= budget.1 {
            return Some(Voxelized {
                primitive: None,
                group: group.group,
                level: group.level,
                triangle_error: group.error,
                forced: false,
                side,
                brick_parents: vec![f64::INFINITY; packed.len()],
                voxels,
                bricks: packed,
            });
        }
        side *= GROWTH;
    }
    None
}

/// Each of `candidates` sampled against the primitive's triangles that overlap it.
fn sampled(surface: &Surface<'_>, candidates: &[Cell], side: f64) -> Vec<Voxel> {
    let world = &surface.probe.mesh.world;
    let at: HashMap<Cell, usize> = (candidates.iter().enumerate())
        .map(|(i, &c)| (c, i))
        .collect();
    let bound = |k: usize, pick: fn(i32, i32) -> i32, end: i32| {
        let c = candidates.iter().map(|c| c[k]).reduce(pick).unwrap_or(0);
        f64::from(c + end) * side
    };
    let low: [f64; 3] = std::array::from_fn(|k| bound(k, i32::min, 0));
    let high: [f64; 3] = std::array::from_fn(|k| bound(k, i32::max, 1));
    let mut bins: Vec<Vec<u32>> = vec![Vec::new(); candidates.len()];
    for (t, (from, to)) in surface.range.clone().zip(surface.boxes) {
        if (0..3).any(|k| from[k] > high[k] || to[k] < low[k]) {
            continue;
        }
        let c = [0, 1, 2].map(|k| vertex(world, t, k));
        cells(c, side, |cell| {
            if let Some(&i) = at.get(&cell) {
                bins[i].push(t as u32);
            }
        });
    }
    (candidates.par_iter().zip(&bins))
        .map(|(&cell, ranks)| {
            let (coverage, faces, seen) = sample(surface.probe, cell, side, ranks);
            let materials = &surface.probe.mesh.materials;
            let material = seen.and_then(|s| materials[s as usize]);
            let joint = surface.joints.and_then(|j| {
                let of = ranks.iter().map(|&r| j[r as usize - surface.range.start]);
                most(of.filter(|&j| j != u16::MAX))
            });
            Voxel {
                cell,
                coverage,
                faces,
                shown: Moments::default(),
                closed: 0,
                material: material.map(|m| m.min(u64::from(u16::MAX - 1)) as u16),
                joint,
            }
        })
        .collect()
}

/// Per triangle of source mesh `mesh`, the joint its corners weigh most (`u16::MAX` for none),
/// when a primitive of it is skinned.
fn mesh_joints(
    inputs: &VoxelInputs<'_>,
    mesh: usize,
    traceable: &Traceable,
) -> Result<Option<Vec<u16>>> {
    let mut out: Option<Vec<u16>> = None;
    for (index, range) in &traceable.primitives {
        if let Some(joints) = triangle_joints(inputs, mesh, *index)? {
            let all = out.get_or_insert_with(|| vec![u16::MAX; traceable.world.tags.len()]);
            all[range.clone()].copy_from_slice(&joints);
        }
    }
    Ok(out)
}

/// Per triangle of primitive `index` of `mesh`, the joint its corners weigh most, when it is
/// skinned.
fn triangle_joints(
    inputs: &VoxelInputs<'_>,
    mesh: usize,
    index: usize,
) -> Result<Option<Vec<u16>>> {
    let p = &inputs.g["meshes"][mesh]["primitives"][index];
    if p.pointer("/attributes/JOINTS_0").is_none() {
        return Ok(None);
    }
    let (positions, indices, _) = read(inputs.g, inputs.bin, p, None)?;
    let count = positions.count;
    let deformation = page_deformation(inputs.g, inputs.bin, p, count, &BTreeSet::new())?;
    let Some((joints, weights)) = deformation.skin else {
        return Ok(None);
    };
    let per = joints.len() / count.max(1);
    let joint = |t: &[u32]| {
        let mut weighed: BTreeMap<u32, f32> = BTreeMap::new();
        for k in t
            .iter()
            .flat_map(|&v| v as usize * per..(v as usize + 1) * per)
        {
            *weighed.entry(joints[k]).or_default() += weights[k];
        }
        let best = weighed.into_iter().max_by(|a, b| a.1.total_cmp(&b.1));
        best.map_or(u16::MAX, |(j, _)| j.min(u32::from(u16::MAX - 1)) as u16)
    };
    Ok(Some(indices.chunks_exact(3).map(joint).collect()))
}

/// `voxels.bin`: the head, the groups' records, the bricks, the voxels.
fn encode(done: &[Voxelled]) -> Vec<u8> {
    let groups = || done.iter().flat_map(|mesh| mesh.groups.iter());
    let bricks: usize = groups().map(|g| g.bricks.len()).sum();
    let voxels: usize = groups().map(|g| g.voxels.len()).sum();
    let count = groups().count();
    let mut head = Vec::with_capacity(HEAD_BYTES + count * GROUP_BYTES);
    let mut brick_bytes = Vec::with_capacity(bricks * BRICK_BYTES);
    let mut voxel_bytes = Vec::with_capacity(voxels * VOXEL_BYTES);
    head.extend_from_slice(b"T3VX");
    for word in [VOXEL_VERSION, count as u32, bricks as u32] {
        head.extend_from_slice(&word.to_le_bytes());
    }
    for group in groups() {
        let first: Cell =
            std::array::from_fn(|k| group.bricks.iter().map(|b| b.at[k]).min().unwrap_or(0));
        let origin = first.map(|c| (f64::from(c) * 4.0 * group.side) as f32);
        let words = [
            group.primitive.map_or(u32::MAX, |p| p as u32),
            group.group as u32,
            (brick_bytes.len() / BRICK_BYTES) as u32,
            group.bricks.len() as u32,
            (voxel_bytes.len() / VOXEL_BYTES) as u32,
            group.voxels.len() as u32,
        ];
        for word in words {
            head.extend_from_slice(&word.to_le_bytes());
        }
        let errors = [group.error(), group.parent_error(), group.side].map(|e| e as f32);
        for value in errors.into_iter().chain(origin) {
            head.extend_from_slice(&value.to_le_bytes());
        }
        for brick in &group.bricks {
            brick_bytes.extend_from_slice(&brick_record(brick, first));
            for &v in &brick.voxels {
                voxel_bytes.extend_from_slice(&voxel_record(&group.voxels[v], group.side));
            }
        }
    }
    head.extend(brick_bytes);
    head.extend(voxel_bytes);
    head
}

/// The manifest's `voxels` section: the file's layout and totals, and every mesh's groups.
fn report(inputs: &VoxelInputs<'_>, done: &[Voxelled], bytes: usize) -> Value {
    let all = || done.iter().flat_map(|mesh| mesh.groups.iter());
    let finite = |e: f64| e.is_finite().then_some(e);
    let group = |g: &Voxelized| {
        json!({"primitive": g.primitive, "group": g.group, "level": g.level,
        "triangleError": finite(g.triangle_error), "error": g.error(),
        "parentError": finite(g.parent_error()), "side": g.side, "forced": g.forced,
        "bricks": g.bricks.len(), "voxels": g.voxels.len()})
    };
    let meshes: Vec<Value> = (done.iter())
        .map(|mesh| {
            let seeded = (inputs.primitives.iter().zip(inputs.seeds))
                .filter(|(p, _)| p["mesh"].as_u64() == Some(mesh.mesh as u64))
                .map(|(_, seed)| seed.groups.len().saturating_sub(1))
                .sum::<usize>();
            json!({"mesh": mesh.mesh, "voxelsFrom": mesh.voxels_from, "seeded": seeded,
                "groups": mesh.groups.iter().map(group).collect::<Vec<_>>()})
        })
        .collect();
    json!({"version": VOXEL_VERSION, "file": VOXEL_FILE, "bytes": bytes,
        "headBytes": HEAD_BYTES, "groupBytes": GROUP_BYTES, "brickBytes": BRICK_BYTES,
        "voxelBytes": VOXEL_BYTES, "errorPerSide": ERROR_PER_SIZE,
        "groups": all().count(),
        "bricks": all().map(|g| g.bricks.len()).sum::<usize>(),
        "voxels": all().map(|g| g.voxels.len()).sum::<usize>(), "meshes": meshes})
}
