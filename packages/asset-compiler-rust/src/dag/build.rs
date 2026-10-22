//! The build of a DAG (`build_dag`): the source read as a mesh build reads it (`input.rs`), its
//! level 0 cut, every level above it built (`levels.rs`), then every cluster stripped of its
//! degenerate triangles and laid in strips.
use super::clusters::first_uses;
use super::*;

impl DagCluster {
    /// A level-0 cluster in no group yet: a root of its own, `sphere` bounding both its error and
    /// its parent's.
    pub(crate) fn leaf(
        indices: Vec<u32>,
        lod_error: f64,
        sphere: [f64; 4],
        source_rank: u32,
    ) -> Self {
        Self {
            indices,
            level: 0,
            lod_error,
            parent_error: f64::INFINITY,
            sphere,
            whole_box: None,
            parent_sphere: sphere,
            source_rank,
            group: None,
            source: None,
        }
    }
}

/// A built DAG: its clusters, the groups kept, one tally per level, the stalled groups with their
/// level, the arrays it reads — the source's as the build read them (`input.rs`), grown with every
/// vertex a solve placed (`Grown`), none when they are the source's own —, and the source's
/// triangles as the build read them, which level 0 partitions: the near-collapsed ones dropped,
/// each corner at the vertex its weld points it at (`input::welded`); and, per such triangle, its
/// rank among the source's triangles (`triangle_source`), which the triangles dropped leave
/// out of `indices`.
pub struct DagBuild {
    pub clusters: Vec<DagCluster>,
    pub groups: Vec<DagGroup>,
    pub tallies: Vec<GroupTally>,
    pub stalls: Vec<DagStall>,
    pub grown: Option<Grown>,
    pub indices: Vec<u32>,
    pub triangle_source: Vec<u32>,
}

/// Builds cluster DAG. `settings` decide whether coarse levels exist — in `ExactClusters` build
/// yields level zero alone, without group or reduction, so published coverage is exactly source
/// triangles — and what every solve keeps (`DagSettings`).
///
/// The source is first read as a mesh build reads it (`input.rs`, `DagSettings::input`): each
/// vertex built, its normal and stored tangent rebuilt as the mesh's rules name it; without bones,
/// a triangle two of whose corners meet dropped (`input::kept_triangles`,
/// `DagSettings::drop_near_collapsed`) and every corner pointed at the first vertex laid before it
/// at its position that matches it within the build's tolerances (`input::welded`); with bones,
/// the corners welded within the rules' skinned weld and the triangles two of whose corners are
/// then one vertex dropped (`input::welded_skinned`); so an
/// unindexed mesh clusters as the indexed one it draws the same as. Once level 0 is cut, every
/// value is held within its range and corrected as a solve corrects it (`input::finished`).
/// `attributes` — the normals, the stored tangents, every texture set and the colour — count in
/// the reduction error; a position written under several texture coordinates is a seam no
/// collapse crosses.
///
/// Returns the clusters, the groups kept, one tally per level and every stalled group with its
/// level, in level order, and the source's triangles as read (`DagBuild`), the arrays held within
/// range (`input::held`).
pub fn build_dag(
    positions: &[f32],
    attributes: DagAttributes,
    indices: &[u32],
    settings: impl Into<DagSettings>,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<DagBuild> {
    let mut build = build_levels(positions, attributes, indices, settings.into(), checkpoint)?;
    finish(&mut build, positions);
    Ok(build)
}

/// The DAG of `build_dag` before the encoder's steps: the source read, level 0 cut and every level
/// above it built, the clusters as the reductions made them (`finish` lays them). An assembly
/// reads its own level 0 so and builds the levels above its instances' roots over it
/// (`assembly.rs`).
pub(super) fn build_levels(
    positions: &[f32],
    attributes: DagAttributes,
    indices: &[u32],
    settings: DagSettings,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<DagBuild> {
    checkpoint()?;
    // The seam weld's key holds the texture sets a page can carry, no more.
    if attributes.uv_sets().len() > trillion3d_page_codec::MAX_UV_SETS {
        return Err(invalid("a page carries at most four texture sets"));
    }
    let mut built = input::built(positions, attributes, indices, &settings.input);
    let skin = trillion3d_page_codec::FLAG_SKIN;
    let skinned = attributes.carried.iter().any(|a| a.flag == skin);
    let (indices, triangle_source) = {
        let _t = Timer::new(Phase::Weld);
        match skinned {
            true => input::welded_skinned(&mut built, settings.input.skinned_weld),
            false => {
                let near = settings.drop_near_collapsed;
                let (kept, ranks) = input::kept_triangles(&built.positions, &built.indices, near);
                let source: Vec<u32> = ranks.iter().map(|&t| built.source[t as usize]).collect();
                (input::welded(&built, &kept), source)
            }
        }
    };
    if indices.is_empty() {
        return Err(CompilerError::new(
            "INVALID_TRIANGLES",
            "Every triangle has two corners at one point",
        ));
    }
    // The corner each vertex first appears at, whose triangle's rank keeps the draw order stable.
    let first_use = first_uses(built.positions.len() / 3, &indices);
    let Cut {
        clusters: level0,
        outer,
    } = {
        let _t = Timer::new(Phase::ClusterLevel0);
        cluster_source(&built.positions, &indices, DAG_CLUSTER_TRIANGLES)?
    };
    // Held within range and corrected once cut, as each level-0 cluster's vertices are.
    let grown = input::finished(built, &indices, (positions, attributes));
    let (drawn, carried) = Grown::level(&grown, positions, attributes);
    let welds = {
        let _t = Timer::new(Phase::Weld);
        welds::Welds::of(drawn, DagAttributes { carried: &carried }, &indices)
    };
    let mut dag: Vec<DagCluster> = Vec::with_capacity(level0.len());
    let mut identities = Vec::with_capacity(level0.len());
    let mut begin = 0;
    for cluster in level0 {
        let end = begin + cluster.len() / 3;
        identities.push(identity::of_range(begin, end));
        begin = end;
        let sphere = bounds::points_ball(drawn, &cluster);
        let source_rank = cluster
            .iter()
            .map(|&v| first_use.get(v as usize).copied().unwrap_or(u32::MAX))
            .min()
            .map_or(0, |corner| {
                if corner == u32::MAX {
                    corner
                } else {
                    corner / 3
                }
            });
        dag.push(DagCluster::leaf(cluster, 0.0, sphere, source_rank));
    }
    let build = if settings.strategy == DagStrategy::ExactClusters || dag.len() < 2 {
        DagBuild {
            clusters: dag,
            groups: Vec::new(),
            tallies: Vec::new(),
            stalls: Vec::new(),
            grown,
            indices,
            triangle_source,
        }
    } else {
        let source = (positions, attributes, indices, triangle_source);
        let level0 = (dag, identities, outer);
        super::levels::coarsen(source, (welds, grown), level0, settings, checkpoint)?
    };
    Ok(build)
}

/// The encoder's steps, once every level is built: the triangles with two equal corners go, then
/// the strips and the vertex cap, which the partition never read, and the vertices the pages read
/// are held within range. `positions` are the source's, which a build that placed nothing draws.
pub(super) fn finish(build: &mut DagBuild, positions: &[f32]) {
    remove_degenerate(&mut build.clusters);
    let drawn = build.grown.as_ref().map_or(positions, |g| &g.positions[..]);
    constrain_wide(drawn, &mut build.clusters, &mut build.groups);
    // What the pages read, the vertices the solves placed with the source's, within range.
    input::held(&mut build.grown);
}

/// A mesh without bones as the build's input lays it (`laid_source`): its positions, its
/// attributes and the corners of its triangles, each at the vertex it is welded to.
pub(crate) struct Laid {
    pub positions: Vec<f32>,
    pub attributes: Vec<trillion3d_page_codec::encode::Attribute>,
    pub indices: Vec<u32>,
}

/// The first steps of `build_dag` for a mesh without bones, and no more: the source read as a mesh
/// build reads it (`input.rs`) by `rules` — each vertex built, a triangle two of whose corners meet
/// dropped (`drop_near_collapsed`), every corner welded to the first vertex at its position that
/// matches it, every value held within its range and corrected — and returned, the vertices a
/// weld left alone among them. The mesh a displacement is baked into is this one
/// (`displace::bake`), its build then reading the result as made (`InputRules::as_made`).
pub(crate) fn laid_source(
    positions: &[f32],
    attributes: DagAttributes,
    indices: &[u32],
    (rules, drop_near_collapsed): (&InputRules, bool),
) -> Laid {
    let built = input::built(positions, attributes, indices, rules);
    let (kept, _) = input::kept_triangles(&built.positions, &built.indices, drop_near_collapsed);
    let welded = input::welded(&built, &kept);
    let grown = input::finished(built, &welded, (positions, attributes));
    let (laid, carried) = Grown::level(&grown, positions, attributes);
    Laid {
        positions: laid.to_vec(),
        attributes: carried.into_iter().cloned().collect(),
        indices: welded,
    }
}
