//! The arrays of a spline pass (`../spline.rs`): the triangle primitives of a source mesh decoded
//! once (`decode_mesh`), each bent under a node's curve (`bend_mesh`) and laid in new accessors
//! (`bend_primitive`).
use super::bend::{Bend, Fit};
use super::*;
use crate::compiler::source::synth::{
    attribute, float_accessor, index_accessor, position_accessor,
};
use trillion3d_math::geometry::aabb::aabb_of_f32;
use trillion3d_math::vector::vec3::point_f32;

/// The bent copy of mesh `mesh` under `bend`, its source decoded (`decode_mesh`) unless `cache`
/// holds it from an earlier node, and kept there while `remaining` says another node bends it.
pub(super) fn bent_copy(
    g: &mut Value,
    out: &mut Vec<u8>,
    (mesh, cache, remaining): (
        usize,
        &mut BTreeMap<usize, Decoded>,
        &mut BTreeMap<usize, usize>,
    ),
    bend: &Bend,
) -> Result<Value> {
    let decoded = match cache.remove(&mesh) {
        Some(decoded) => decoded,
        None => decode_mesh(g, out, mesh)?,
    };
    let bent = bend_mesh(g, out, mesh, &decoded, bend)?;
    if let Some(nodes) = remaining.get_mut(&mesh) {
        *nodes -= 1;
        if *nodes > 0 {
            cache.insert(mesh, decoded);
        }
    }
    Ok(bent)
}

/// One triangle primitive's arrays, as the bend reads them: its positions, its triangles' corners
/// and the normals and tangents it carries.
struct Arrays {
    positions: Vec<f32>,
    indices: Vec<u32>,
    normals: Option<Vec<f32>>,
    tangents: Option<Vec<f32>>,
}

impl Arrays {
    /// The arrays of triangle primitive `p`; refused when it has bones or morph targets.
    fn read(g: &Value, bin: &[u8], p: &Value) -> Result<Self> {
        if !triangles::is_rigid(p) {
            return Err(SPLINE.bad("a skinned or morphed mesh cannot be bent"));
        }
        let (positions, indices, _) = triangles::read(g, bin, p, None)?;
        let positions = positions.collect_f32()?;
        let count = positions.len() / 3;
        Ok(Self {
            normals: attribute(g, bin, p, ("NORMAL", 3), count)?,
            tangents: attribute(g, bin, p, ("TANGENT", 4), count)?,
            positions,
            indices,
        })
    }

    /// Every vertex bent by `bend` under `fit`: its position, and the normal and tangent it may
    /// carry, and, when the bend mirrors the mesh, its triangles turned over and the tangents' sign
    /// — the frame's handedness — reversed. A vertex the bend sends to a point that is not a
    /// number is refused.
    fn bend(&self, (bend, fit): (&Bend, Fit)) -> Result<Self> {
        let count = self.positions.len() / 3;
        let mirror = if bend.mirrors() { -1.0 } else { 1.0 };
        let turned_over = |triangle: &[u32]| [triangle[0], triangle[2], triangle[1]];
        let mut done = Self {
            positions: Vec::with_capacity(self.positions.len()),
            indices: match bend.mirrors() {
                true => self.indices.chunks_exact(3).flat_map(turned_over).collect(),
                false => Vec::new(),
            },
            normals: self.normals.as_ref().map(|_| Vec::with_capacity(count * 3)),
            tangents: self
                .tangents
                .as_ref()
                .map(|_| Vec::with_capacity(count * 4)),
        };
        let tangents = self.tangents.as_deref().map(|t| t.as_chunks::<4>().0);
        for v in 0..count {
            let carried = tangents.map(|t| t[v]);
            let normal = self.normals.as_deref().map(|n| point_f32(n, v));
            let at = point_f32(&self.positions, v);
            let tangent = carried.map(|t| [t[0], t[1], t[2]]);
            let bent = bend.vertex(fit, at, normal, tangent);
            let laid = [Some(bent.pos), bent.normal, bent.tangent];
            if laid.iter().flatten().flatten().any(|c| !c.is_finite()) {
                return Err(SPLINE.bad("the bend sends a vertex to a point that is not a number"));
            }
            done.positions.extend(bent.pos);
            done.normals
                .iter_mut()
                .zip(bent.normal)
                .for_each(|(into, n)| into.extend(n));
            let signed = (done.tangents.as_mut(), bent.tangent, carried);
            if let (Some(into), Some(turned), Some(source)) = signed {
                into.extend(turned);
                into.push(source[3] * mirror);
            }
        }
        Ok(done)
    }
}

/// The arrays of the triangle primitives of a source mesh, each decoded once, and the box of all
/// their points: what every bend of the mesh reads (`decode_mesh`).
pub(super) struct Decoded {
    arrays: Vec<Option<Arrays>>,
    extent: ([f32; 3], [f32; 3]),
}

/// Mesh `mesh` of `g` decoded from the binary `bin`: each triangle primitive read once, the box of
/// them all the extent a bend fits to; refused when it holds no triangle.
fn decode_mesh(g: &Value, bin: &[u8], mesh: usize) -> Result<Decoded> {
    let source = item(values(g, "meshes")?, mesh, "mesh")?;
    let mut arrays = Vec::new();
    for p in values(source, "primitives")? {
        arrays.push(match triangles::is_triangle_list(p) {
            true => Some(Arrays::read(g, bin, p)?),
            false => None,
        });
    }
    let points = arrays
        .iter()
        .flatten()
        .flat_map(|a| a.positions.as_chunks::<3>().0.iter().copied());
    let extent = aabb_of_f32(points);
    if extent.0[0] > extent.1[0] {
        return Err(SPLINE.bad("the mesh has no triangle to bend"));
    }
    Ok(Decoded { arrays, extent })
}

/// Mesh `mesh` bent by `bend`, as a new mesh whose arrays are appended to `out`: each triangle
/// primitive of `decoded` bent in turn, fitted to the box of them all.
fn bend_mesh(
    g: &mut Value,
    out: &mut Vec<u8>,
    mesh: usize,
    decoded: &Decoded,
    bend: &Bend,
) -> Result<Value> {
    let mut bent = item(values(g, "meshes")?, mesh, "mesh")?.clone();
    let primitives = values(&bent, "primitives")?.clone();
    let fit = bend.fit(decoded.extent);
    let mut done = Vec::with_capacity(primitives.len());
    for (p, arrays) in primitives.iter().zip(&decoded.arrays) {
        done.push(match arrays {
            Some(arrays) => bend_primitive(g, out, p, arrays.bend((bend, fit))?, bend)?,
            None => p.clone(),
        });
    }
    bent["primitives"] = Value::Array(done);
    Ok(bent)
}

/// Primitive `p` with the `bent` arrays in place of its own: new accessors for its positions,
/// normals and tangents, and for its corners when the bend mirrors (turned over, so the surface
/// still faces out).
fn bend_primitive(
    g: &mut Value,
    out: &mut Vec<u8>,
    p: &Value,
    bent: Arrays,
    bend: &Bend,
) -> Result<Value> {
    let mut primitive = p.clone();
    let arrays = &mut primitive["attributes"];
    arrays["POSITION"] = json!(position_accessor(g, out, &bent.positions)?);
    if let Some(normals) = &bent.normals {
        arrays["NORMAL"] = json!(float_accessor(g, out, normals, ("VEC3", 3))?);
    }
    if let Some(tangents) = &bent.tangents {
        arrays["TANGENT"] = json!(float_accessor(g, out, tangents, ("VEC4", 4))?);
    }
    if bend.mirrors() {
        primitive["indices"] = json!(index_accessor(g, out, &bent.indices)?);
    }
    Ok(primitive)
}
