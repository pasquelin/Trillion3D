//! `QemAttributes` reduction of one group: the attribute-aware simplifier, then the sorting of
//! its survivors between vertices the buffer already holds and vertices the solve created.
use super::*;
use crate::qem_attributes::{simplify_region_with_attributes, UpdatedRegion, LOCK, PROTECT};

pub(super) fn updated(
    input: &GroupReductionInput,
    source: &[u32],
    required: &[u32],
    lock: &dyn Fn(u32) -> bool,
) -> Result<Try> {
    let weights = attributes::component_weights(input.attributes);
    let gather = |remap: &[u32]| attributes::gather(input.attributes, remap);
    let flags = |vertex: u32| {
        let protected = input.protect.get(vertex as usize).copied().unwrap_or(false);
        (u8::from(lock(vertex)) * LOCK) | (u8::from(protected) * PROTECT)
    };
    let Some(region) = simplify_region_with_attributes(
        input.positions,
        source,
        &gather,
        &weights,
        source.len() / 3 / 2,
        SIMPLIFY_ERROR_CEILING,
        &flags,
    )?
    else {
        return Ok(Try::NoCollapse);
    };
    let (named, vertices) = sort_survivors(input, &region, &weights);
    let floor = if vertices.count() > 0 {
        region.scale * f32::EPSILON as f64
    } else {
        0.0
    };
    let corners: Vec<u32> = region.indices.iter().map(|&l| named[l as usize]).collect();
    Try::of(required, &corners, input.weld, || {
        let clusters = {
            let _t = Timer::new(Phase::Resplit);
            cluster_triangles(&region.positions, &region.indices, DAG_CLUSTER_TRIANGLES)?
        };
        Ok(Attempt {
            // The simplifier's error already bounds how far the level's surface left the
            // source's: the solve that follows the collapses moves a survivor towards the
            // minimum of its own quadric, and the distance it travels — a facade vertex sliding
            // along its wall covers the whole group — is not a deviation of that surface.
            // Only the floor is added, so a level that created any vertex carries a positive
            // error and a surface no longer bit for bit the source is never drawn at zero.
            error_object: region.error_object.max(floor),
            clusters: clusters
                .into_iter()
                .map(|cluster| cluster.iter().map(|&l| named[l as usize]).collect())
                .collect(),
            vertices,
            relocked: false,
        })
    })
}

/// A solve that moved a vertex by less than this fraction of the region's extent, and left every
/// weighed attribute within the same fraction, did not move it: the vertex keeps its buffer index
/// instead of becoming a copy of itself. The fraction is read against the region, as the
/// simplifier reads its own error, so it means the same on a leaf and on a facade.
const SOLVE_TOLERANCE: f64 = 1e-4;

/// Names every surviving local vertex: a survivor the solve left within `SOLVE_TOLERANCE` of the
/// vertex it started from keeps its buffer index — a locked vertex always does, which is what
/// keeps two groups meeting on the same vertices —, the others become new vertices ranked in the
/// order the surviving triangles first use them. Returns, with them, the largest object-space
/// displacement between a survivor as drawn and the source position it started from — at least
/// one single-precision ulp of the region's extent when vertices were created without moving, so
/// the error stays positive once the runtime packs it as `f32`.
fn sort_survivors(
    input: &GroupReductionInput,
    region: &UpdatedRegion,
    weights: &[f32],
) -> (Vec<u32>, NewVertices) {
    let stride = weights.len();
    let tolerance = region.scale * SOLVE_TOLERANCE;
    let mut named = vec![u32::MAX; region.remap.len()];
    let mut new = NewVertices::default();
    let mut source_attributes = Vec::with_capacity(stride);
    for &local in &region.indices {
        let l = local as usize;
        if named[l] != u32::MAX {
            continue;
        }
        let source = region.remap[l] as usize;
        source_attributes.clear();
        for a in input.attributes {
            let width = a.width;
            source_attributes.extend_from_slice(&a.values[source * width..(source + 1) * width]);
        }
        let solved = &region.attributes[l * stride..(l + 1) * stride];
        let position = &input.positions[source * 3..source * 3 + 3];
        let moved = region.displacement(l, position);
        // A weight says what one unit of an attribute is worth against the region's extent: the
        // drift is judged in that same currency as the position, so one tolerance covers both.
        let drifted =
            solved
                .iter()
                .zip(&source_attributes)
                .zip(weights)
                .any(|((solved, from), weight)| {
                    (*solved as f64 - *from as f64).abs() * *weight as f64 > SOLVE_TOLERANCE
                });
        named[l] = if moved <= tolerance && !drifted {
            source as u32
        } else {
            let rank = new.count() as u32;
            new.positions
                .extend_from_slice(&region.positions[l * 3..l * 3 + 3]);
            new.attributes.extend_from_slice(solved);
            new.protected.push(input.protect[source]);
            NEW_VERTEX | rank
        };
    }
    (named, new)
}
