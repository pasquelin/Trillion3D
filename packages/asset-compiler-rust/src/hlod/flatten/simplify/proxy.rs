//! The simplified mesh from its simplification on (`Proxy`): one value of each attribute per vertex
//! — position, normal, the normal its transfer rays follow, texture coordinates — and its
//! triangles; and vertices split by copying (`split`), every attribute the mesh holds per vertex
//! copied with its position.
use super::reduce::Soup;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{length, sub};

/// The simplified mesh: per vertex its position (the method's frame, centimetres), its normal, the
/// normal its transfer rays follow (`transfer`, none before it is kept) and its texture
/// coordinates (none before the mesh is charted); and its triangles, three indices each,
/// clockwise seen from outside.
#[derive(Default)]
pub(super) struct Proxy {
    pub points: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub transfer: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
}

/// `values`, one per vertex of the `count` the mesh held, followed by a copy of the value of each
/// vertex `copies` names; left as it is when it holds no value per vertex.
fn extended<T: Copy>(values: &mut Vec<T>, count: usize, copies: &[u32]) {
    if values.len() == count && !copies.is_empty() {
        values.extend(
            copies
                .iter()
                .map(|&v| values[v as usize])
                .collect::<Vec<T>>(),
        );
    }
}

impl Proxy {
    /// The simplified `soup` as the mesh: its positions, normals and triangles.
    pub(super) fn of(soup: Soup) -> Self {
        let (points, normals) = soup.vertices.iter().map(|v| (v.position, v.normal)).unzip();
        Self {
            points,
            normals,
            indices: soup.indices,
            ..Self::default()
        }
    }

    /// The mesh with a copy of each vertex `copies` names appended, in order, each copy taking
    /// every attribute its vertex holds.
    pub(super) fn split(&mut self, copies: &[u32]) {
        let count = self.points.len();
        extended(&mut self.points, count, copies);
        extended(&mut self.normals, count, copies);
        extended(&mut self.transfer, count, copies);
        extended(&mut self.uvs, count, copies);
    }

    /// Triangle `t`'s corners.
    pub(super) fn corners(&self, t: usize) -> [[f32; 3]; 3] {
        [0, 1, 2].map(|k| self.points[self.indices[3 * t + k] as usize])
    }

    /// The bounding sphere's radius, centimetres: the farthest vertex from the centre of the
    /// vertices' box, single precision.
    pub(super) fn radius(&self) -> f32 {
        let mut low = [f32::MAX; 3];
        let mut high = [-f32::MAX; 3];
        for p in &self.points {
            for k in 0..3 {
                low[k] = low[k].min(p[k]);
                high[k] = high[k].max(p[k]);
            }
        }
        let centre: [f32; 3] = std::array::from_fn(|k| (low[k] + high[k]) * 0.5);
        let farthest = (self.points.iter())
            .map(|p| (0..3).map(|k| (p[k] - centre[k]).powi(2)).sum::<f32>())
            .fold(0.0f32, f32::max);
        farthest.sqrt()
    }

    /// The surface's area, square centimetres: each triangle's half cross product in single
    /// precision, summed in double precision in triangle order.
    pub(super) fn area(&self) -> f64 {
        let mut total = 0.0f64;
        for t in 0..self.indices.len() / 3 {
            let [a, b, c] = self.corners(t);
            total += f64::from(0.5 * length(cross(sub(c, a), sub(b, a))));
        }
        total
    }
}
