//! Closed solids built in code for the compiler's tests (#484): boxes and octagonal 0.12 m logs,
//! each a closed part whose faces point away from its centre, with the normals an exporter writes,
//! and the one-node fixture that cooks them. The chalet of #415 is a committed scene instead,
//! built of the same parts by `scripts/docs/examples/closed-parts.ts`: keep the two in step.
use super::silhouette::Mesh;
use super::*;

/// The logs: 0.12 m in radius, octagonal, in eight segments.
const LOG_RADIUS: f32 = 0.12;
const LOG_SEGMENTS: usize = 8;

/// One triangle: per corner, its position and its normal.
type Triangle = [([f32; 3], [f32; 3]); 3];

/// Triangles pushed in pairs, each pair a quad, then turned to face away from their convex part's
/// centre. Corners of one quad equal in position and normal are one vertex; each quad writes its
/// own, as the open world's exporter writes them: twins in everything a page stores.
fn push_part(mesh: &mut Mesh, triangles: &[Triangle], centre: [f32; 3]) {
    let mut shared = std::collections::HashMap::new();
    for (rank, triangle) in triangles.iter().enumerate() {
        let p = triangle.map(|(p, _)| p.map(f64::from));
        let normal = crate::shared_math::cross(
            crate::shared_math::sub(p[1], p[0]),
            crate::shared_math::sub(p[2], p[0]),
        );
        let outward = crate::shared_math::sub(p[0], centre.map(f64::from));
        let order = if crate::shared_math::dot(normal, outward) < 0.0 {
            [0, 2, 1]
        } else {
            [0, 1, 2]
        };
        for k in order {
            let (position, normal) = triangle[k];
            let key = (
                rank / 2,
                position.map(f32::to_bits),
                normal.map(f32::to_bits),
            );
            let index = *shared.entry(key).or_insert_with(|| {
                mesh.positions.push(position.map(f64::from));
                mesh.normals.push(normal.map(f64::from));
                mesh.positions.len() as u32 - 1
            });
            mesh.indices.push(index);
        }
    }
}

/// A closed box, flat faces.
pub(super) fn push_box(mesh: &mut Mesh, min: [f32; 3], max: [f32; 3]) {
    let centre = std::array::from_fn(|a| (min[a] + max[a]) / 2.0);
    push_part(mesh, &box_triangles(min, max), centre);
}

/// The twelve triangles of a closed box, unordered.
fn box_triangles(min: [f32; 3], max: [f32; 3]) -> Vec<Triangle> {
    let mut triangles = Vec::new();
    for axis in 0..3 {
        let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
        for (side, sign) in [(min[axis], -1.0), (max[axis], 1.0)] {
            let mut normal = [0.0; 3];
            normal[axis] = sign;
            let corner = |a: f32, b: f32| {
                let mut p = [0.0; 3];
                (p[axis], p[u], p[v]) = (side, a, b);
                (p, normal)
            };
            let (a, b, c, d) = (
                corner(min[u], min[v]),
                corner(max[u], min[v]),
                corner(max[u], max[v]),
                corner(min[u], max[v]),
            );
            triangles.extend([[a, b, c], [a, c, d]]);
        }
    }
    triangles
}

/// A closed octagonal log along `axis` from `start` over `length`, smooth sides and flat caps.
pub(super) fn push_log(mesh: &mut Mesh, axis: usize, start: [f32; 3], length: f32) {
    let s = 0.5f32.sqrt();
    let ring = [
        (1.0, 0.0),
        (s, s),
        (0.0, 1.0),
        (-s, s),
        (-1.0, 0.0),
        (-s, -s),
        (0.0, -1.0),
        (s, -s),
    ];
    let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
    let point = |along: f32, (cu, cv): (f32, f32)| {
        let mut p = start;
        p[axis] += along;
        p[u] += cu * LOG_RADIUS;
        p[v] += cv * LOG_RADIUS;
        let mut n = [0.0; 3];
        (n[u], n[v]) = (cu, cv);
        (p, n)
    };
    let mut triangles = Vec::new();
    let step = length / LOG_SEGMENTS as f32;
    for segment in 0..LOG_SEGMENTS {
        let (a0, a1) = (segment as f32 * step, (segment + 1) as f32 * step);
        for k in 0..ring.len() {
            let (r0, r1) = (ring[k], ring[(k + 1) % ring.len()]);
            let q = [point(a0, r0), point(a1, r0), point(a1, r1), point(a0, r1)];
            triangles.extend([[q[0], q[1], q[2]], [q[0], q[2], q[3]]]);
        }
    }
    for (along, sign) in [(0.0, -1.0), (length, 1.0)] {
        let cap = |r| {
            let (p, _) = point(along, r);
            let mut n = [0.0; 3];
            n[axis] = sign;
            (p, n)
        };
        for k in 1..ring.len() - 1 {
            triangles.push([cap(ring[0]), cap(ring[k]), cap(ring[k + 1])]);
        }
    }
    let mut centre = start;
    centre[axis] += length / 2.0;
    push_part(mesh, &triangles, centre);
}

/// One node drawing `mesh` as one primitive, positions and normals as `f32`.
pub(super) fn mesh_fixture(tag: &str, mesh: &Mesh) -> (PathBuf, Options) {
    let mut buffer = GltfBuffer::default();
    let vec3 = |points: &[[f64; 3]]| -> Vec<u8> {
        points
            .iter()
            .flatten()
            .flat_map(|&v| (v as f32).to_le_bytes())
            .collect()
    };
    let count = mesh.positions.len();
    let (min, max) = (0..3).fold((vec![], vec![]), |(mut lo, mut hi), a| {
        let values = mesh.positions.iter().map(|p| p[a] as f32);
        lo.push(values.clone().fold(f32::INFINITY, f32::min));
        hi.push(values.fold(f32::NEG_INFINITY, f32::max));
        (lo, hi)
    });
    let position = buffer.push(
        vec3(&mesh.positions),
        json!({"componentType":5126,"type":"VEC3","count":count,"min":min,"max":max}),
    );
    let normal = buffer.push(
        vec3(&mesh.normals),
        json!({"componentType":5126,"type":"VEC3","count":count}),
    );
    let indices = mesh.indices.iter().flat_map(|v| v.to_le_bytes()).collect();
    let index = buffer.push(
        indices,
        json!({"componentType":5125,"type":"SCALAR","count":mesh.indices.len()}),
    );
    let primitive =
        json!({"attributes":{"POSITION":position,"NORMAL":normal},"indices":index,"material":0});
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":format!("{tag}.bin"),"byteLength":buffer.bin.len()}],
        "bufferViews":buffer.views,"accessors":buffer.accessors,"meshes":[{"primitives":[primitive]}],"nodes":[{"mesh":0}],
        "scenes":[{"nodes":[0]}],"scene":0,"materials":[{"pbrMetallicRoughness":{"metallicFactor":0.0}}]});
    gltf_fixture(tag, &gltf, &buffer.bin)
}
