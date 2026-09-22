//! `QemAttributes` reduction of one group: the weights the group's own triangles derive, then
//! the attribute-aware simplifier on them.
use super::*;
use crate::qem::SimplifiedMesh;
use crate::qem_attributes::{simplify_region_with_attributes, LOCK};

pub(super) fn simplify(
    input: &GroupReductionInput,
    source: &[u32],
    lock: &dyn Fn(u32) -> bool,
) -> Result<SimplifiedMesh> {
    let weights = attributes::component_weights(input.positions, source, input.attributes);
    let gather = |remap: &[u32]| attributes::gather(input.attributes, remap);
    let flags = |vertex: u32| {
        let carried = input
            .vertex_flags
            .get(vertex as usize)
            .copied()
            .unwrap_or(0);
        (u8::from(lock(vertex)) * LOCK) | carried
    };
    simplify_region_with_attributes(
        input.positions,
        source,
        &gather,
        &weights,
        source.len() / 3 / 2,
        SIMPLIFY_ERROR_CEILING,
        &flags,
    )
}
