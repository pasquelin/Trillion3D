//! What a primitive's DAG hands the voxel stage: the groups that may be drawn as voxels, each with
//! what the voxel rule weighs — its children's area, vertices and errors, the clusters its
//! reduction plans (`num_parents`), its triangles' error — and the level-0 triangles it stands for.
//!
//! A group may be drawn as voxels only on a mesh whose shape preservation is `Voxelize`
//! (`ShapePreservation`), the author's opt-in, and then every group may: the stage keeps its
//! voxels when they beat its triangles, or always when a child is voxels (`stage.rs`). Above the
//! roots, where the DAG stops, one more group stands for them all and every triangle — the
//! primitive's share of its mesh's far group, voxel levels that keep coarsening past a voxel root
//! (`stage.rs`). Each level-0 cluster belongs to one
//! group of each level above it: a group's outputs share its clusters, each to the output nearest
//! it, so siblings stand for disjoint triangles. A group's triangles are kept child by child
//! (`SeedGroup::child_triangles`): the stage takes a voxel child's cells from its voxels, not from
//! the triangles it stands for (`stage/inherit.rs`).
use super::ERROR_PER_SIZE;
use crate::dag::{DagCluster, DagGroup, DAG_CLUSTER_TRIANGLES};
use trillion3d_math::geometry::triangle::triangle_area;
use trillion3d_math::vector::vec3::point;
use trillion3d_math::vector::vecn::{distance2, mean};
use trillion3d_page_codec::encode::vertices::first_use;
use trillion3d_page_codec::hash::WordMap;

pub(crate) struct SeedGroup {
    /// Rank among the primitive's DAG groups, as the structure report lists them; one past the
    /// last for the group above the roots.
    pub group: usize,
    pub level: usize,
    /// The error of its triangles' reduction, infinite above the roots.
    pub error: f64,
    /// Each child's source group, `None` at level 0, and error.
    pub children: Vec<(Option<usize>, f64)>,
    /// Each output's centre and the group it is a child of — one past the last DAG group for a
    /// root, the group above the roots —; none above the roots.
    pub parents: Vec<([f64; 3], usize)>,
    /// Its children's area and vertices, and the clusters its reduction plans: its children's
    /// triangles over two clusters, rounded up, since a reduction halves them (one above the
    /// roots).
    pub area: f64,
    pub vertices: usize,
    pub num_parents: usize,
    /// The level-0 triangles it stands for, ranks in the primitive's triangle list: each child's
    /// share, sorted, end to end in the children's order; `child_ends` ends each share.
    pub triangles: Vec<u32>,
    pub child_ends: Vec<usize>,
}

impl SeedGroup {
    /// The seed of a group of `children`, still without parents and triangles.
    fn of(
        dag: &[DagCluster],
        pos: &[f32],
        (group, level, error): (usize, usize, f64),
        children: &[usize],
    ) -> Self {
        let mut seed = SeedGroup {
            group,
            level,
            error,
            children: Vec::with_capacity(children.len()),
            parents: Vec::new(),
            area: 0.0,
            vertices: 0,
            num_parents: 0,
            triangles: Vec::new(),
            child_ends: Vec::new(),
        };
        let mut triangles = 0;
        for &c in children {
            let child = &dag[c];
            seed.vertices += first_use(child.indices.iter().copied()).0.len();
            let corner = |t: &[u32; 3], k: usize| point(pos, t[k]);
            seed.area += (child.indices.as_chunks::<3>().0.iter())
                .map(|t| triangle_area(corner(t, 0), corner(t, 1), corner(t, 2)))
                .sum::<f64>();
            seed.children.push((child.source, child.lod_error));
            triangles += child.triangles();
        }
        seed.num_parents = triangles.div_ceil(DAG_CLUSTER_TRIANGLES * 2);
        seed
    }

    /// Child `child`'s share of the triangles: those of the level-0 triangles it stands for.
    pub fn child_triangles(&self, child: usize) -> &[u32] {
        let start = child
            .checked_sub(1)
            .map_or(0, |before| self.child_ends[before]);
        &self.triangles[start..self.child_ends[child]]
    }

    /// Its triangles set to the children's `shares`, in the children's order.
    fn share_out(&mut self, shares: impl Iterator<Item = Vec<u32>>) {
        for share in shares {
            self.triangles.extend(share);
            self.child_ends.push(self.triangles.len());
        }
    }

    /// The voxel budget: three for every four of its children's vertices, so the voxels cost about
    /// what the triangles they replace do.
    pub fn target_voxels(&self) -> usize {
        (self.vertices * 3 / 4).max(1)
    }

    /// The first voxel side: the budget spread over the children's area, times ¾, never
    /// finer than the error its children are drawn at allows.
    pub fn first_side(&self, child_error: f64) -> f64 {
        let spread = (self.area / self.target_voxels() as f64).sqrt() * 0.75;
        spread.max(child_error / ERROR_PER_SIZE)
    }
}

/// A mesh's shape preservation: `Voxelize` for a mesh the job voxelizes — by its `voxelize`
/// match, its HLOD `voxel` chain or its own glTF `extras.shapePreservation` (`VOXELIZE_EXTRA`:
/// `"none"` the default, `"area"` or `"voxelize"`; any other value refuses the job) —
/// (`compiler::args::voxelize::VoxelizeOptions::meshes`); `Area` for a mesh whose extras name `"area"`, its
/// simplification keeping the area its border loses (`simplify::SolveRules::keep_area`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum ShapePreservation {
    #[default]
    None,
    Area,
    Voxelize,
}

impl ShapePreservation {
    /// The setting glTF mesh `mesh`'s own `extras` names, `None` when they name none; a value
    /// that is not one of the three words is the job's refusal (`INVALID_OPTIONS`), as any
    /// option's.
    pub(crate) fn of(mesh: &serde_json::Value) -> crate::Result<Self> {
        let key = crate::shared_math::abi::VOXELIZE_EXTRA;
        let named = (mesh.get("extras").and_then(|e| e.get(key))).filter(|v| !v.is_null());
        match named.map(|v| v.as_str()) {
            None | Some(Some("none")) => Ok(Self::None),
            Some(Some("area")) => Ok(Self::Area),
            Some(Some("voxelize")) => Ok(Self::Voxelize),
            Some(_) => Err(crate::CompilerError::new(
                "INVALID_OPTIONS",
                format!("A mesh's extras.{key} must be \"none\", \"area\" or \"voxelize\""),
            )),
        }
    }
}

/// The groups of one primitive that may be drawn as voxels, in level order, the group above its
/// roots last — every group, or none (`of`) — and every DAG group's error, at which its children
/// are replaced while it is drawn as triangles.
#[derive(Default)]
pub(crate) struct VoxelSeed {
    pub groups: Vec<SeedGroup>,
    pub errors: Vec<f64>,
}

impl VoxelSeed {
    /// The group of rank `rank` among the DAG's groups: the groups are seeded in rank order, the
    /// group above the roots last.
    pub(crate) fn group(&self, rank: usize) -> &SeedGroup {
        &self.groups[rank]
    }

    /// The seed of a DAG: `pos` the arrays its clusters index, `indices` its level-0 triangles
    /// and `source` each one's rank among the source's triangles — the ranks the voxels sample
    /// the mesh's triangles by (`DagBuild::triangle_source`) —, `shape` its mesh's setting. Empty
    /// unless `Voxelize`: voxels are tried on no other mesh.
    pub(crate) fn of(
        dag: &[DagCluster],
        groups: &[DagGroup],
        (pos, indices, source): (&[f32], &[u32], &[u32]),
        shape: ShapePreservation,
    ) -> Self {
        if shape != ShapePreservation::Voxelize {
            return Self::default();
        }
        let mut seeded = Vec::with_capacity(groups.len() + 1);
        for (g, group) in groups.iter().enumerate() {
            let rank = (g, group.level, group.error);
            let mut seed = SeedGroup::of(dag, pos, rank, &group.children);
            let parent = |o: usize| (centre(&dag[o], pos), dag[o].group.unwrap_or(groups.len()));
            seed.parents = group.outputs.iter().map(|&o| parent(o)).collect();
            seeded.push(seed);
        }
        let roots: Vec<usize> = (0..dag.len()).filter(|&c| dag[c].is_root()).collect();
        let level = dag.iter().map(|c| c.level).max().unwrap_or(0) + 1;
        let mut above = SeedGroup::of(dag, pos, (groups.len(), level, f64::INFINITY), &roots);
        above.num_parents = 1;
        seeded.push(above);
        own_triangles(dag, (groups, &roots), (pos, indices, source), &mut seeded);
        Self {
            groups: seeded,
            errors: groups.iter().map(|g| g.error).collect(),
        }
    }
}

/// The mean of a cluster's corners.
fn centre(c: &DagCluster, pos: &[f32]) -> [f64; 3] {
    mean(c.indices.iter().map(|&v| point(pos, v)))
}

/// A triangle's corners turned to start at its least vertex: one key whichever corner the strips
/// of its cluster start it at (`dag::constrain_wide`).
fn turned(corners: &[u32]) -> [u32; 3] {
    let at = (0..3).min_by_key(|&k| corners[k]).unwrap_or(0);
    [0, 1, 2].map(|k| corners[(at + k) % 3])
}

/// Fills each seeded group's level-0 triangles, child by child, as ranks among the source's
/// (`source`, per triangle of `indices`): every cluster holds the level-0 clusters it stands for,
/// a level-0 cluster itself; a group gathers its children's and hands each to its output nearest
/// it, centre to centre; the group above the roots takes the `roots`'.
fn own_triangles(
    dag: &[DagCluster],
    (groups, roots): (&[DagGroup], &[usize]),
    (pos, indices, source): (&[f32], &[u32], &[u32]),
    seeded: &mut [SeedGroup],
) {
    let centres: Vec<[f64; 3]> = dag.iter().map(|c| centre(c, pos)).collect();
    let distance = |a: usize, b: usize| distance2(centres[a], centres[b]);
    let mut own: Vec<Vec<u32>> = (dag.iter().enumerate())
        .map(|(slot, c)| match c.level {
            0 => vec![slot as u32],
            _ => Vec::new(),
        })
        .collect();
    // A triangle's source rank by its corners, from whichever it starts; a repeated triangle takes
    // its first rank.
    let rank: WordMap<[u32; 3], u32> = (indices.as_chunks::<3>().0.iter().enumerate().rev())
        .map(|(t, c)| (turned(c), source[t]))
        .collect();
    // The source ranks of the triangles of `leaves`, sorted.
    let ranks = |leaves: &[u32]| {
        let corners = (leaves.iter()).flat_map(|&l| dag[l as usize].indices.as_chunks::<3>().0);
        let mut triangles: Vec<u32> =
            (corners.filter_map(|c| rank.get(&turned(c)).copied())).collect();
        triangles.sort_unstable();
        triangles
    };
    let mut next = seeded.iter_mut().peekable();
    for (g, group) in groups.iter().enumerate() {
        let shares: Vec<Vec<u32>> = (group.children.iter())
            .map(|&c| std::mem::take(&mut own[c]))
            .collect();
        for &leaf in shares.iter().flatten() {
            let nearest = (group.outputs.iter()).min_by(|&&a, &&b| {
                distance(leaf as usize, a).total_cmp(&distance(leaf as usize, b))
            });
            if let Some(&output) = nearest {
                own[output].push(leaf);
            }
        }
        if let Some(seed) = next.next_if(|s| s.group == g) {
            seed.share_out(shares.iter().map(|leaves| ranks(leaves)));
        }
    }
    if let Some(above) = next.next() {
        let shares = roots.iter().map(|&r| ranks(&std::mem::take(&mut own[r])));
        above.share_out(shares);
    }
}
