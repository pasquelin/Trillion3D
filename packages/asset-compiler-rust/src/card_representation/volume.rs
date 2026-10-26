//! The voxel volume a mesh's cards are fitted in, and the six frames its rays run in: one per axis
//! direction, a ray running along the direction against the mesh's side, through the volume's
//! columns of cells. Lengths are centimetres, the reference's unit, and the volume is sized, as the
//! reference sizes it, in single precision.
use super::abi::MESH_CARDS_DIRECTIONS;

type Vec3 = [f64; 3];

/// The voxel the volume aims at, in centimetres: a volume of more voxels than the most it holds
/// takes larger ones.
const TARGET_VOXEL: f32 = 10.0;
/// The voxels a ray starts before the volume's side, so that it starts outside a surface lying on
/// that side or past it: the volume's cells are whole voxels, the mesh's bounds are not.
const PULLBACK_VOXELS: f32 = 2.0;
/// The axes of a card on its direction's axis: its first and its second (the third is the
/// direction's own).
const CARD_AXES: [(Vec3, Vec3); 3] = [
    ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
    ([1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
    ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
];

/// The frame of one direction: where its rays start, how they run and how the volume's cells are
/// laid out along its columns.
pub(super) struct Basis {
    /// The card's two axes in the mesh's space.
    pub x: Vec3,
    pub y: Vec3,
    /// The way the rays run: against the direction the card faces.
    pub ray: Vec3,
    /// The corner of the volume the rays' columns count from, in the mesh's space.
    pub offset: Vec3,
    /// The cells along the card's first axis, its second and the rays'.
    pub size: [i32; 3],
}

impl Basis {
    /// The direction the card faces, out of the mesh.
    pub(super) fn normal(&self) -> Vec3 {
        self.ray.map(|c| -c)
    }

    /// The point of the mesh's space at `local` — the distances along the card's two axes and the
    /// rays — from the corner.
    pub(super) fn to_mesh(&self, local: Vec3) -> Vec3 {
        [0, 1, 2].map(|k| {
            local[0] * self.x[k] + local[1] * self.y[k] + local[2] * self.ray[k] + self.offset[k]
        })
    }

    /// The distances along the card's two axes and the rays from the corner of `point`.
    pub(super) fn to_local(&self, point: Vec3) -> Vec3 {
        let from = [0, 1, 2].map(|k| point[k] - self.offset[k]);
        [self.x, self.y, self.ray].map(|axis| (0..3).map(|k| from[k] * axis[k]).sum::<f64>())
    }
}

/// The volume over a mesh's bounds and its six frames.
pub(super) struct Volume {
    /// The side of a voxel, centimetres.
    pub voxel: f32,
    /// The frame of each direction: `-x`, `+x`, `-y`, `+y`, `-z`, `+z`.
    pub bases: [Basis; MESH_CARDS_DIRECTIONS],
    /// The mean area of a face of the volume, in voxels: what a card's coverage must reach is held
    /// to half of it.
    pub average_face_area: f32,
    /// The length of the segment a ray is cast along: it holds the volume's diagonal and the
    /// pull-back with room to spare, so no triangle lies past it.
    pub reach: f64,
}

impl Volume {
    /// The volume over `low, high`, a side of at most `most` voxels.
    pub(super) fn of((low, high): (Vec3, Vec3), most: u32) -> Self {
        let most = most as f32;
        let centre = [0, 1, 2].map(|k| (0.5 * (low[k] + high[k])) as f32);
        let size: [f32; 3] = [0, 1, 2].map(|k| 2.0 * (0.5 * (high[k] - low[k])) as f32);
        let largest = size[0].max(size[1]).max(size[2]);
        let in_voxels = (largest / TARGET_VOXEL + 0.5).clamp(1.0, most);
        let voxel = TARGET_VOXEL.max(largest / in_voxels);
        let cells = size.map(|s| (s / voxel + 0.5).floor().clamp(1.0, most) as i32);
        let half = cells.map(|c| c as f32 * voxel * 0.5);
        let corners = (
            [0, 1, 2].map(|k| centre[k] - half[k]),
            [0, 1, 2].map(|k| centre[k] + half[k]),
        );
        let area = |a: i32, b: i32| (a * b) as f32;
        let faces = area(cells[0], cells[1]) + area(cells[0], cells[2]) + area(cells[1], cells[2]);
        let diagonal = cells
            .iter()
            .map(|&c| (f64::from(c) * f64::from(voxel)).powi(2))
            .sum::<f64>()
            .sqrt();
        Self {
            voxel,
            bases: std::array::from_fn(|direction| basis(direction, cells, corners)),
            average_face_area: 2.0 * faces / 6.0,
            reach: diagonal + f64::from((PULLBACK_VOXELS + 2.0) * voxel),
        }
    }

    /// The distance a ray starts before the volume's side.
    pub(super) fn pullback(&self) -> f32 {
        PULLBACK_VOXELS * self.voxel
    }
}

/// The frame of direction `direction` over a volume of `cells` cells between `corners`: a card
/// looks along the direction's axis, out of the mesh, from the side its sign names; its rays start
/// on the volume's opposite side of the mesh from that, and run against the direction.
fn basis(direction: usize, cells: [i32; 3], (low, high): ([f32; 3], [f32; 3])) -> Basis {
    let axis = direction / 2;
    let facing_up = direction & 1 == 1;
    let (x, y) = CARD_AXES[axis];
    let mut ray = [0.0; 3];
    ray[axis] = if facing_up { -1.0 } else { 1.0 };
    let mut offset = low.map(f64::from);
    if facing_up {
        offset[axis] = f64::from(high[axis]);
    }
    let size = match axis {
        0 => [cells[1], cells[2], cells[0]],
        1 => [cells[0], cells[2], cells[1]],
        _ => cells,
    };
    Basis {
        x,
        y,
        ray,
        offset,
        size,
    }
}
