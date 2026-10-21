//! The simplified mesh charted and packed into its atlas (`charted`): its mesh cleaned and its face
//! adjacency made (`clean`), then cut into charts by the spectral partition — as many charts as it
//! takes, each stretching by at most 0.125 on the library's scale, every face's metric the
//! identity, so the charts follow the surface's own lengths — and the charts packed for an atlas of
//! the given side with the given gutter (`uv::spectral`). The partition splits a vertex along every
//! cut: the mesh takes the partition's triangles, its vertices copied as the partition's remap says
//! — position, normal and transfer normal —, each its packed coordinates. A mesh the cleaning or
//! the library cannot chart is not charted, and the actor fails.
use super::clean::cleaned;
use super::proxy::Proxy;
use crate::hlod::flatten::uv::spectral::{chart, pack, ChartQuality};

/// The most stretch a chart may reach, on the library's scale from 0 (none) to 1 (any).
const MOST_STRETCH: f32 = 0.125;

/// Every face's integrated metric tensor: the identity, `[1, 0, 1]`.
const IDENTITY: [f32; 3] = [1.0, 0.0, 1.0];

/// `values`, one per vertex before the partition, as the partition's vertices take them.
fn remapped(values: &[[f32; 3]], remap: &[u32]) -> Vec<[f32; 3]> {
    remap.iter().map(|&v| values[v as usize]).collect()
}

/// `proxy` charted and packed for an atlas `side` texels square with `gutter` texels between its
/// charts (module doc); `false`, the mesh as the cleaning left it, when it cannot be charted.
pub(super) fn charted(proxy: &mut Proxy, side: usize, gutter: f32) -> bool {
    let Some(adjacency) = cleaned(proxy) else {
        return false;
    };
    let faces = proxy.indices.len() / 3;
    let signal: Vec<f32> = IDENTITY.repeat(faces);
    let limits = (0, MOST_STRETCH);
    let partition = chart(
        &proxy.points,
        &proxy.indices,
        &adjacency,
        None,
        Some(signal.as_slice()),
        limits,
        ChartQuality::ByFaceCount,
    );
    let Ok(mut charted) = partition else {
        return false;
    };
    if pack(&mut charted, (side, side), gutter).is_err() {
        return false;
    }
    proxy.indices = charted.indices;
    proxy.uvs = charted.uvs;
    proxy.points = remapped(&proxy.points, &charted.remap);
    proxy.normals = remapped(&proxy.normals, &charted.remap);
    proxy.transfer = remapped(&proxy.transfer, &charted.remap);
    true
}
