//! The voxel stage: every seeded group of every primitive tried by the voxel rule, level by level,
//! then each mesh's far group, and the groups drawn as voxels written in one product,
//! `voxels.bin`, which the manifest's `voxels` section names.
//!
//! A group's side starts at its first (`SeedGroup::first_side`) and grows by `GROWTH` until its
//! solid voxels fit the group's budget — three for every four of its children's vertices, and as
//! many bricks as its planned parents hold triangles —, as long as their error stays below its
//! triangles'. A group whose child comes from a voxel group has no triangles to beat — once a
//! level is voxels, every level above is —: it is drawn as voxels, at the side its budget allows.
//! Its candidate cells come from that child's voxels and the cells it remembered, those of its
//! other children from their triangles; a group none of whose children is voxels takes them from
//! its triangles (`inherit.rs`). A mesh's far group exists only above roots drawn as voxels: only
//! a voxel root keeps coarsening past the DAG's top.
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
//! A mesh's voxelization lives in `mesh`, the surface sampling in `surface`, what a group takes of
//! its voxel children in `inherit`, the encoding and report in `encode`. How a mesh's voxels are sampled — its rays, the level from which every group is
//! voxels, the fit of its normals, its opacity — is its build's (`VoxelSettings`), one per
//! source mesh (`VoxelInputs::settings`).
use super::bricks::Brick;
use super::raster::Cell;
use super::seed::VoxelSeed;
use super::solid::Voxel;
use super::{VoxelSettings, ERROR_PER_SIZE, VOXEL_FILE};
use crate::compiler::cache::storage::{product, Product};
use crate::texture::TexturePreview;
use crate::Result;
use rayon::prelude::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;
mod mesh;
use mesh::voxelize_mesh;
mod encode;
mod inherit;
mod surface;
use encode::{encode, report};

/// Bytes of the head and of a group's record.
const HEAD_BYTES: usize = 16;
const GROUP_BYTES: usize = 48;

/// How much the side grows between two tries: fine enough steps that the side found sits close to
/// the budget.
const GROWTH: f64 = 1.1;

/// What the stage reads: the scene, its previews, its meshes' map, the compiled primitives and,
/// beside each, its seed, and how each source mesh's voxels are sampled (its build's).
pub(crate) struct VoxelInputs<'a> {
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub previews: &'a [TexturePreview],
    pub mesh_map: &'a BTreeMap<usize, usize>,
    pub primitives: &'a [Value],
    pub seeds: &'a [VoxelSeed],
    pub settings: &'a [VoxelSettings],
}

/// A group drawn as voxels — of a primitive's DAG, or a mesh's far group (`primitive` `None`, `group`
/// the compiled mesh) — and, per brick, the error it is replaced at (infinite for a far group);
/// the cells it has no voxel in but remembers, which the group above takes its candidates from.
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
    remembered: Vec<Cell>,
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

    /// Its fields but its voxels, bricks, their parents and its remembered cells.
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
            remembered: Vec::new(),
        }
    }
}

/// A mesh's groups drawn as voxels, its far group last, the error from which it draws nothing
/// else — the largest a triangle cluster of any of its primitives is replaced at — and how its
/// voxels were sampled, which their records follow.
struct Voxelled {
    mesh: usize,
    groups: Vec<Voxelized>,
    voxels_from: f64,
    settings: VoxelSettings,
}

/// Voxelizes every seeded group, then every mesh's far group, and writes `voxels.bin` in
/// `directory`; returns its product and the manifest's `voxels` section.
pub(crate) fn stage_voxels(
    inputs: &VoxelInputs<'_>,
    directory: &Path,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(Product, Value)> {
    let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::Voxels);
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
