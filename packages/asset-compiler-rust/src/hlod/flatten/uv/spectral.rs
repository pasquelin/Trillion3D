//! Charts cut by spectral analysis of the surface and packed into one atlas, step for step and
//! value for value as the bundled atlas library of the reference proxy builder computes them, in
//! single precision where it rounds in single precision.
//!
//! `chart` cuts a mesh into charts and gives each its plane coordinates:
//!
//! 1. the input is checked (`engine::input`): the false edges, when given, must lie between faces
//!    and join corners that also join through true edges;
//! 2. the shared surface (`source`): the points centred and scaled into a cube of side 500, each
//!    face's normal, area and canonical frame, the per-face signal tensor;
//! 3. the root chart (`build`): the corners renumbered along the given adjacency, the faces split
//!    along the edges more than two faces or a false edge share, every edge found, every vertex's
//!    ring sorted, the mesh refused when it is not a manifold;
//! 4. the initial charts (`cut`): the root split into its connected objects, each object's extra
//!    boundaries joined along their shortest path until one remains, each vertex ranked by the
//!    order a quadric simplification would remove it (`simplify`);
//! 5. the partition loop (`engine::partition`): each chart flattened by landmark multidimensional
//!    scaling of its geodesic distances (`spectrum`, `geodesic`), recognised as a plane, a trivial
//!    shape, a cylinder or a horn, else clustered around representative vertices (`shape`), the
//!    clusters made valid manifolds (`partition`) and their borders moved by graph cuts on the
//!    dihedral angle or the stretch (`boundary`); the stretch of every kept chart is then lowered
//!    by moving its vertices (`stretch`), and the chart of largest stretch split in two again until
//!    the stretch bound and the chart count are met;
//! 6. the small charts merged with their neighbours while the stretch allows (`merge`), the charts
//!    scaled to their optimal relative sizes, the result exported with every vertex a cut separates
//!    duplicated (`engine::export`).
//!
//! `pack` lays the charts into the unit square for a texture of the given size (`pack`): the
//! charts sorted by area, each tried in its rotations against the borders of what is placed, put
//! where it wastes least space with the gutter kept around it, the whole layout restarted smaller
//! when a chart does not fit.
//!
//! Where the library returns a failure, these return an error; an allocation failure, which the
//! library reports, ends the process here as everywhere in the compiler. The library's progress
//! callback reports and never decides: it is not ported.
mod boundary;
mod build;
mod criteria;
mod cut;
mod draw;
mod engine;
mod fail;
mod geodesic;
mod merge;
mod mesh;
mod pack;
mod partition;
mod ranked;
mod shape;
mod simplify;
mod source;
mod spectrum;
mod stretch;
mod util;

/// Every face's integrated metric tensor when the charts follow the surface's own lengths: the
/// identity, `[1, 0, 1]`.
pub(crate) const IDENTITY_METRIC: [f32; 3] = [1.0, 0.0, 1.0];

/// How the geodesic distances of the partition are measured: by the exact window propagation on
/// every mesh without a signal, or (the library's default) exactly below 25 000 faces and by the
/// fast edge-path propagation above.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub(crate) enum ChartQuality {
    #[default]
    ByFaceCount,
    Quality,
}

/// What partitioning made: the mesh re-split along chart cuts.
pub(crate) struct Charted {
    /// Per output vertex, its coordinates in its chart's parameterisation.
    pub uvs: Vec<[f32; 2]>,
    /// The output triangles, 3 per face, in the input's face order.
    pub indices: Vec<u32>,
    /// Per output vertex, the input vertex it copies.
    pub remap: Vec<u32>,
    /// 3 per face, the face across each edge, `u32::MAX` across a cut.
    pub cut_adjacency: Vec<u32>,
    /// The state the partition left the library's random generator in: the packing draws on from
    /// it, as the library's calls draw from one generator.
    pub draw: u32,
}

/// Partition: the library's entry point, same inputs. `adjacency` and `false_edges` hold 3 per
/// face, `u32::MAX` for none; `signal` holds the optional per-face integrated metric tensor, 3
/// floats per face.
pub(crate) fn chart(
    points: &[[f32; 3]],
    indices: &[u32],
    adjacency: &[u32],
    false_edges: Option<&[u32]>,
    signal: Option<&[f32]>,
    (max_charts, max_stretch): (usize, f32),
    quality: ChartQuality,
) -> crate::Result<Charted> {
    engine::partition(
        engine::Request {
            points,
            indices,
            adjacency,
            false_edges,
            signal,
            max_charts,
            max_stretch,
        },
        quality,
    )
}

/// Pack: rewrites `charted.uvs` into [0,1]² for a `width`×`height` texture with `gutter` texels,
/// using `charted.cut_adjacency`, exactly as the library's pack entry point.
pub(crate) fn pack(
    charted: &mut Charted,
    (width, height): (usize, usize),
    gutter: f32,
) -> crate::Result<()> {
    pack::pack_charted(charted, width, height, gutter)
}
