//! What the tessellation asks of the displacement (`Displacer`): the displacement at a point of a
//! triangle — the interpolated normal, made unit, times the height map's displacement at the
//! interpolated texture coordinates, the triangle's material naming the map —, the range of error
//! a sub-triangle may carry against the triangle's own interpolation of its corners'
//! displacements, and how many samples a sub-triangle deserves, by the texels it covers. What a
//! triangle's corners hold of all this — their normals, their texture coordinates and the map — is
//! read once for the triangle (`Shape`), not at every point asked.
use super::affine::{Affine, AffineV};
use super::map::DisplacementMap;
use super::mesh::Soup;
use crate::simplify::unit_or_same;
use trillion3d_math::vector::vecn::scale;

/// The height maps a mesh's triangles are displaced by, one for each material, and where the
/// normal and the texture set they read start in a vertex's row (none: a zero normal, the
/// coordinates 0, 0).
pub(super) struct Displacer<'a> {
    pub maps: &'a [DisplacementMap],
    pub normal: Option<usize>,
    pub uv: Option<usize>,
}

/// What a triangle's displacement reads of its corners: their normals and texture coordinates, and
/// the map of its material, none for a material that names none.
pub(super) struct Shape<'a> {
    normals: [[f32; 3]; 3],
    uvs: [[f32; 2]; 3],
    map: Option<&'a DisplacementMap>,
}

impl<'a> Displacer<'a> {
    /// The map of `material`, none for a material that names none.
    fn map(&self, material: i32) -> Option<&'a DisplacementMap> {
        let maps = self.maps;
        usize::try_from(material).ok().and_then(|at| maps.get(at))
    }

    /// The row of `vertex`'s floats from `start`.
    fn read<const N: usize>(&self, mesh: &Soup, vertex: u32, start: Option<usize>) -> [f32; N] {
        start.map_or([0.0; N], |at| {
            let row = mesh.row(vertex);
            std::array::from_fn(|k| row[at + k])
        })
    }

    /// What the displacement of the triangle of `corners` and `material` reads of them.
    pub(super) fn shape(&self, mesh: &Soup, corners: [u32; 3], material: i32) -> Shape<'a> {
        Shape {
            normals: corners.map(|vertex| self.read(mesh, vertex, self.normal)),
            uvs: corners.map(|vertex| self.read(mesh, vertex, self.uv)),
            map: self.map(material),
        }
    }

    /// The displacement of `vertex` as a corner of `triangle`: at the vertex itself.
    pub(super) fn of_vertex(&self, mesh: &Soup, vertex: u32, triangle: usize) -> [f32; 3] {
        self.shape(mesh, [vertex; 3], mesh.material(triangle))
            .at([1.0, 0.0, 0.0])
    }

    /// The displacement of the point of `triangle` at the weights `bary` of its corners.
    pub(super) fn in_triangle(&self, mesh: &Soup, triangle: usize, bary: [f32; 3]) -> [f32; 3] {
        let shape = self.shape(mesh, mesh.triangle(triangle), mesh.material(triangle));
        shape.at(bary)
    }
}

impl Shape<'_> {
    /// The texture coordinates at the barycentric weights `bary` of the corners.
    fn uv_at(&self, bary: [f32; 3]) -> [f32; 2] {
        let uvs = self.uvs;
        let mut uv = [uvs[0][0] * bary[0], uvs[0][1] * bary[0]];
        for k in 1..3 {
            uv[0] += uvs[k][0] * bary[k];
            uv[1] += uvs[k][1] * bary[k];
        }
        uv
    }

    /// The displacement of the point at the barycentric weights `bary` of the corners: along the
    /// interpolated normal, made unit.
    pub(super) fn at(&self, bary: [f32; 3]) -> [f32; 3] {
        let uv = self.uv_at(bary);
        let normals = self.normals;
        let mut normal = scale(normals[0], bary[0]);
        for k in 1..3 {
            let term = scale(normals[k], bary[k]);
            normal = [
                normal[0] + term[0],
                normal[1] + term[1],
                normal[2] + term[2],
            ];
        }
        let height = self.map.map_or(0.0, |map| map.sample(uv));
        scale(unit_or_same(normal), height)
    }

    /// The least and the most squared distance a sub-triangle, whose corners are at the barycentric
    /// weights `bary`, may lie from the interpolation of the displacements `d` of the triangle's
    /// corners: the displacement the map allows over the texture rectangle the sub-triangle covers,
    /// along the normal the sub-triangle's corners span, against that interpolation, both over the
    /// sub-triangle's weights as affine forms.
    pub(super) fn error_bounds(&self, bary: &[[f32; 3]; 3], d: &[[f32; 3]; 3]) -> [f32; 2] {
        let range = |axis: usize| {
            let along = bary.map(|b| b[axis]);
            let low = along[0].min(along[1]).min(along[2]);
            let high = along[0].max(along[1]).max(along[2]);
            (low, high)
        };
        let ((low0, high0), (low1, high1)) = (range(0), range(1));
        let weight0 = Affine::symbol(low0, high0, 0);
        let weight1 = Affine::symbol(low1, high1, 1);
        let weight2 = Affine::constant(1.0).minus(weight0).minus(weight1);
        let weights = [weight0, weight1, weight2];
        let blend = |vectors: [[f32; 3]; 3]| {
            let mut sum = AffineV::constant(vectors[0]).times(weights[0]);
            for k in 1..3 {
                sum = sum.plus(AffineV::constant(vectors[k]).times(weights[k]));
            }
            sum
        };
        let lerped = blend(*d);
        let normal = blend(self.normals).normalized();
        let mut uv_low = [f32::MAX; 2];
        let mut uv_high = [-f32::MAX; 2];
        for b in bary {
            let uv = self.uv_at(*b);
            for axis in 0..2 {
                uv_low[axis] = uv_low[axis].min(uv[axis]);
                uv_high[axis] = uv_high[axis].max(uv[axis]);
            }
        }
        let reach = self.map.map_or([0.0; 2], |map| map.bounds(uv_low, uv_high));
        let displacement = Affine::interval(reach[0], reach[1]);
        let error = normal.times(displacement).minus(lerped).squared_length();
        [error.least(), error.most()]
    }

    /// How many samples the sub-triangle at the weights `bary` deserves: its longest edge or its
    /// area, whichever is more, in texels of the map, rounded up — one for a material with no map.
    pub(super) fn samples(&self, bary: &[[f32; 3]; 3]) -> i32 {
        let Some(map) = self.map else {
            return 1;
        };
        let (width, height) = map.size();
        let uvs = bary.map(|b| {
            let uv = self.uv_at(b);
            [uv[0] * width as f32, uv[1] * height as f32]
        });
        let edge = |from: [f32; 2], to: [f32; 2]| [to[0] - from[0], to[1] - from[1]];
        let squared = |e: [f32; 2]| e[0] * e[0] + e[1] * e[1];
        let edge01 = edge(uvs[0], uvs[1]);
        let edge12 = edge(uvs[1], uvs[2]);
        let edge20 = edge(uvs[2], uvs[0]);
        let longest = squared(edge01)
            .max(squared(edge12))
            .max(squared(edge20))
            .sqrt();
        let area = (0.5 * (edge01[0] * edge12[1] - edge01[1] * edge12[0])).abs();
        longest.max(area).ceil() as i32
    }
}
