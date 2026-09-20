//! `QemAttributes` reduction of one group: the attribute-aware simplifier, then the sorting of
//! its survivors between vertices the buffer already holds and vertices the solve created.
use super::*;
use crate::qem_attributes::{simplify_region_with_attributes, UpdatedRegion};

pub(super) fn updated(
    input: &GroupReductionInput,
    source: &[u32],
    required: &[u32],
    lock: &dyn Fn(u32) -> bool,
) -> Result<Try> {
    let weights = attributes::component_weights(input.attributes);
    let gather = |remap: &[u32]| attributes::gather(input.attributes, remap);
    let Some(region) = simplify_region_with_attributes(
        input.positions,
        source,
        &gather,
        &weights,
        source.len() / 3 / 2,
        SIMPLIFY_ERROR_CEILING,
        lock,
    )?
    else {
        return Ok(Try::NoCollapse);
    };
    let (named, vertices) = sort_survivors(input, &region, weights.len());
    let corners: Vec<u32> = region.indices.iter().map(|&l| named[l as usize]).collect();
    Try::of(required, &corners, input.weld, || {
        let clusters = {
            let _t = Timer::new(Phase::Resplit);
            cluster_triangles(&region.positions, &region.indices, DAG_CLUSTER_TRIANGLES)?
        };
        Ok(Attempt {
            error_object: region.error_object,
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
/// order the surviving triangles first use them.
fn sort_survivors(
    input: &GroupReductionInput,
    region: &UpdatedRegion,
    stride: usize,
) -> (Vec<u32>, NewVertices) {
    let mut named = vec![u32::MAX; region.remap.len()];
    let mut new = NewVertices::default();
    for &local in &region.indices {
        let l = local as usize;
        if named[l] != u32::MAX {
            continue;
        }
        let source = region.remap[l];
        named[l] = if unchanged(input, region, l, source as usize, stride) {
            source
        } else {
            let rank = new.count() as u32;
            new.positions
                .extend_from_slice(&region.positions[l * 3..l * 3 + 3]);
            new.attributes
                .extend_from_slice(&region.attributes[l * stride..(l + 1) * stride]);
            NEW_VERTEX | rank
        };
    }
    (named, new)
}

fn unchanged(
    input: &GroupReductionInput,
    region: &UpdatedRegion,
    local: usize,
    source: usize,
    stride: usize,
) -> bool {
    if region.positions[local * 3..local * 3 + 3] != input.positions[source * 3..source * 3 + 3] {
        return false;
    }
    let solved = &region.attributes[local * stride..(local + 1) * stride];
    let mut offset = 0usize;
    input.attributes.iter().all(|a| {
        let width = a.source_width;
        let same = solved[offset..offset + width] == a.values[source * width..(source + 1) * width];
        offset += width;
        same
    })
}
