//! A card from a cluster: the box of the cluster's cells, extended by half a voxel at each end of
//! the rays and kept within the mesh's bounds, in the frame of its direction.
use super::clusters::Cluster;
use super::volume::Basis;

type Vec3 = [f64; 3];

/// How far, centimetres, a card may reach past the mesh's bounds along the rays: a level of detail
/// or a displacement may move the surface out of them.
const DEPTH_MARGIN: f32 = 10.0;

/// A card: a box looking at the mesh along one of the six axis directions.
#[derive(Clone)]
pub(super) struct Card {
    /// The centre of the box, in the mesh's space.
    pub origin: Vec3,
    /// Its half-extents along its three axes.
    pub extent: Vec3,
    /// Its three axes: the third faces out of the mesh.
    pub axes: [Vec3; 3],
    /// Which direction it looks along: `-x`, `+x`, `-y`, `+y`, `-z`, `+z`.
    pub direction: usize,
}

/// The mesh's bounds `low, high` in the frame of `basis`: the lowest and the highest distance of
/// the box's corners along the card's two axes and the rays from the frame's corner.
pub(super) fn local_bounds(basis: &Basis, (low, high): (Vec3, Vec3)) -> ([f32; 3], [f32; 3]) {
    let corners = (0..8).map(|c| {
        let corner = [0, 1, 2].map(|k| if (c >> k) & 1 == 1 { high[k] } else { low[k] });
        basis.to_local(corner)
    });
    let (mut least, mut most) = ([f32::MAX; 3], [f32::MIN; 3]);
    for local in corners {
        for k in 0..3 {
            least[k] = least[k].min(local[k] as f32);
            most[k] = most[k].max(local[k] as f32);
        }
    }
    (least, most)
}

/// The card of `cluster` for direction `direction`, whose frame is `basis` and cells `voxel` wide,
/// within `bounds`, the mesh's in that frame (`local_bounds`).
pub(super) fn card(
    (basis, direction): (&Basis, usize),
    voxel: f32,
    cluster: &Cluster,
    bounds: ([f32; 3], [f32; 3]),
) -> Card {
    let (low, high) = (
        cluster.low.map(|c| c as f32),
        cluster.high.map(|c| c as f32),
    );
    // The cells' box, half a voxel more at each end of the rays.
    let mut least = [low[0] * voxel, low[1] * voxel, (low[2] - 0.5) * voxel];
    let mut most = [
        (high[0] + 1.0) * voxel,
        (high[1] + 1.0) * voxel,
        (high[2] + 1.5) * voxel,
    ];
    for k in 0..3 {
        let margin = if k == 2 { DEPTH_MARGIN } else { 0.0 };
        least[k] = least[k].max(bounds.0[k] - margin);
        most[k] = most[k].min(bounds.1[k] + margin);
    }
    let centre = [0, 1, 2].map(|k| f64::from((most[k] + least[k]) * 0.5));
    Card {
        origin: basis.to_mesh(centre),
        extent: [0, 1, 2].map(|k| f64::from((most[k] - least[k]) * 0.5)),
        axes: [basis.x, basis.y, basis.normal()],
        direction,
    }
}
