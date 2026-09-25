//! A chalet built of thin closed shapes (#415): a whitewash box for the ground floor, walls of
//! octagonal 0.12 m logs, balcony slabs and boards 0.1 m thick. Every part is a closed solid whose
//! faces point away from its centre, with the normals an exporter writes.
use super::chalet_roof::shingle_roof;
use super::silhouette::Mesh;

/// Footprint and storey of the chalet, in metres, and its logs: 0.12 m in radius, octagonal.
const WIDTH: f32 = 8.0;
const DEPTH: f32 = 6.0;
const GROUND: f32 = 2.8;
const LOG_RADIUS: f32 = 0.12;
const LOGS_PER_WALL: usize = 6;
const LOG_SEGMENTS: usize = 8;
const SLAB: f32 = 0.1;

/// One triangle: per corner, its position and its normal.
pub(super) type Triangle = [([f32; 3], [f32; 3]); 3];

/// Triangles pushed in pairs, each pair a quad, then turned to face away from their convex part's
/// centre. Corners of one quad equal in position and normal are one vertex; each quad writes its
/// own, as the open world's exporter writes them: twins in everything a page stores.
pub(super) fn push_part(mesh: &mut Mesh, triangles: &[Triangle], centre: [f32; 3]) {
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
fn push_box(mesh: &mut Mesh, min: [f32; 3], max: [f32; 3]) {
    let centre = std::array::from_fn(|a| (min[a] + max[a]) / 2.0);
    push_part(mesh, &box_triangles(min, max), centre);
}

/// The twelve triangles of a closed box, unordered.
pub(super) fn box_triangles(min: [f32; 3], max: [f32; 3]) -> Vec<Triangle> {
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
fn push_log(mesh: &mut Mesh, axis: usize, start: [f32; 3], length: f32) {
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

/// The whitewash ground floor, the log walls with their balcony slabs and boards, then the
/// shingle roof on the top log.
pub(in crate::tests) fn chalet() -> [Mesh; 3] {
    let mut whitewash = Mesh::default();
    push_box(
        &mut whitewash,
        [-WIDTH / 2.0, 0.0, -DEPTH / 2.0],
        [WIDTH / 2.0, GROUND, DEPTH / 2.0],
    );
    let mut wood = Mesh::default();
    for k in 0..LOGS_PER_WALL {
        let y = GROUND + LOG_RADIUS * (1 + 2 * k) as f32;
        for side in [-1.0, 1.0] {
            let x = -WIDTH / 2.0 - LOG_RADIUS;
            push_log(
                &mut wood,
                0,
                [x, y, side * DEPTH / 2.0],
                WIDTH + 2.0 * LOG_RADIUS,
            );
            push_log(&mut wood, 2, [side * WIDTH / 2.0, y, -DEPTH / 2.0], DEPTH);
        }
    }
    for side in [-1.0f32, 1.0] {
        let (inner, outer) = (DEPTH / 2.0 + LOG_RADIUS, DEPTH / 2.0 + 1.3);
        let z = |a: f32, b: f32| if side > 0.0 { (a, b) } else { (-b, -a) };
        let (z0, z1) = z(inner, outer);
        push_box(
            &mut wood,
            [-WIDTH / 2.0, GROUND, z0],
            [WIDTH / 2.0, GROUND + SLAB, z1],
        );
        for board in 0..10 {
            let x = -WIDTH / 2.0 + board as f32 * 0.8;
            let (b0, b1) = z(outer - SLAB, outer);
            push_box(
                &mut wood,
                [x, GROUND + SLAB, b0],
                [x + 0.4, GROUND + 1.1, b1],
            );
        }
    }
    let eaves = GROUND + 2.0 * LOG_RADIUS * LOGS_PER_WALL as f32;
    [whitewash, wood, shingle_roof(WIDTH, DEPTH, eaves)]
}
