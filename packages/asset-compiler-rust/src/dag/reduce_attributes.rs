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
    let (named, vertices, deviation) = sort_survivors(input, &region, &weights);
    let corners: Vec<u32> = region.indices.iter().map(|&l| named[l as usize]).collect();
    Try::of(required, &corners, input.weld, || {
        let clusters = {
            let _t = Timer::new(Phase::Resplit);
            cluster_triangles(&region.positions, &region.indices, DAG_CLUSTER_TRIANGLES)?
        };
        Ok(Attempt {
            // A solved vertex is not the source's: how far the solve moved one enters the
            // error, and a level that created any vertex carries a positive error at least,
            // so a surface no longer bit for bit the source is never drawn at threshold zero.
            error_object: region.error_object.max(deviation),
            clusters: clusters
                .into_iter()
                .map(|cluster| cluster.iter().map(|&l| named[l as usize]).collect())
                .collect(),
            vertices,
            relocked: false,
        })
    })
}

/// Names every surviving local vertex: a survivor whose position and attributes are bit for bit
/// what the buffer holds keeps its buffer index — a locked vertex always does, which is what
/// keeps two groups meeting on the same vertices —, the others become new vertices ranked in the
/// order the surviving triangles first use them. Returns, with them, the largest object-space
/// displacement of a new vertex from the source position it started from — the smallest
/// positive number when vertices were created without moving.
fn sort_survivors(
    input: &GroupReductionInput,
    region: &UpdatedRegion,
    weights: &[f32],
) -> (Vec<u32>, NewVertices, f64) {
    let stride = weights.len();
    let mut named = vec![u32::MAX; region.remap.len()];
    let mut new = NewVertices::default();
    let mut deviation = 0.0f64;
    let mut source_attributes = Vec::with_capacity(stride);
    for &local in &region.indices {
        let l = local as usize;
        if named[l] != u32::MAX {
            continue;
        }
        let source = region.remap[l] as usize;
        source_attributes.clear();
        for a in input.attributes {
            let width = a.source_width;
            source_attributes.extend_from_slice(&a.values[source * width..(source + 1) * width]);
        }
        let solved = &region.attributes[l * stride..(l + 1) * stride];
        let position = &input.positions[source * 3..source * 3 + 3];
        named[l] =
            if region.positions[l * 3..l * 3 + 3] == *position && *solved == *source_attributes {
                source as u32
            } else {
                deviation = deviation
                    .max(region.displacement(l, position))
                    .max(f64::MIN_POSITIVE);
                let rank = new.count() as u32;
                new.positions
                    .extend_from_slice(&region.positions[l * 3..l * 3 + 3]);
                new.attributes.extend_from_slice(solved);
                new.protected.push(input.protect[source]);
                NEW_VERTEX | rank
            };
    }
    (named, new, deviation)
}
