//! The partition from input to output: the input checked (`input`), the shared surface and the
//! root chart built, the root split into its initial charts and those partitioned until the
//! stretch bound and the chart count hold (`partition`), the charts exported over the input's
//! vertices (`export`).
use super::build::root_layout;
use super::mesh::Chart;
use super::source::Source;
use super::{ChartQuality, Charted};

mod export;
mod input;
mod partition;

/// The partition's inputs, as the library's entry point takes them.
pub(crate) struct Request<'r> {
    pub points: &'r [[f32; 3]],
    /// 3 per face.
    pub indices: &'r [u32],
    /// 3 per face, the face across each edge, `u32::MAX` for none.
    pub adjacency: &'r [u32],
    /// 3 per face, `u32::MAX` where the edge is a true edge.
    pub false_edges: Option<&'r [u32]>,
    /// 3 per face, the integrated metric tensor.
    pub signal: Option<&'r [f32]>,
    /// The most charts, 0 for no bound.
    pub max_charts: usize,
    /// The stretch bound, from 0 to 1.
    pub max_stretch: f32,
}

/// The mesh of `request` cut into charts, each with its plane coordinates.
pub(crate) fn partition(request: Request, quality: ChartQuality) -> crate::Result<Charted> {
    let max_charts = input::check(&request)?;
    let mut source = Source::new(
        request.points,
        request.indices,
        request.signal,
        request.adjacency,
        request.false_edges,
        quality,
    );
    let layout = root_layout(&mut source, request.indices)?;
    let root = Chart::root(&source, layout)?;
    let initial = partition::initial_charts(root)?;
    let charts = partition::partition(&source, initial, max_charts, request.max_stretch)?;
    export::export(&source, request.indices, &charts)
}
