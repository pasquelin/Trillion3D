use super::*;

/// `triangle_cone` of the mesh of `a_mesh_takes_the_narrowest_cone_the_mean_one_keeping_the_runtime_bits`.
const NARROWEST_BITS: [u64; 4] = [
    0xbfcbf36eb7e7de25,
    0xbfe62fc5fca715b1,
    0x3fe5f9bf21ad4e4b,
    0x3ff1d141d54a5f45,
];

/// Whether `cone` holds every non-degenerate face normal of `indices` over `pos`.
fn holds(cone: [f64; 4], pos: &[f32], indices: &[u32]) -> bool {
    widest_angle(&faces(pos, indices), [cone[0], cone[1], cone[2]]) <= cone[3]
}

#[test]
fn a_mesh_takes_the_narrowest_cone_the_mean_one_keeping_the_runtime_bits() {
    // Positions, indices and the four words `triangleCone` returns in Node for them; the last
    // triangle is degenerate and left out, as the TypeScript leaves it out. fdlibm's arccosine
    // gives Node's angle here, so the mean cone is that angle, the margin up.
    let pos: [f32; 18] = [
        0.0, 0.0, 0.0, 1.0, 0.0, 0.1, 0.3, 1.0, -0.2, -0.7, 0.4, 0.5, 0.2, -0.9, 0.3, 0.5, 0.5, 0.5,
    ];
    let indices = [0, 1, 2, 0, 2, 3, 0, 4, 1, 1, 5, 2, 0, 0, 1];
    let mean = mean_cone(&faces(&pos, &indices));
    assert_eq!(
        mean.map(f64::to_bits),
        [
            0xbfafcd5945b39c98,
            0x3f9bd3ae78eabf1c,
            0x3fefed269ba2a178,
            0x3ffbff6614ce2016 + ANGLE_MARGIN_ULPS as u64
        ]
    );
    // The narrowest cone of the same faces: another axis, an angle 0.64 rad narrower.
    let cone = triangle_cone(&pos, &indices);
    assert_eq!(cone.map(f64::to_bits), NARROWEST_BITS);
    assert!(cone[3] < mean[3]);
    assert!(holds(cone, &pos, &indices));
}

#[test]
fn one_face_is_a_closed_cone_on_its_normal() {
    let pos = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let [x, y, z, angle] = triangle_cone(&pos, &[0, 1, 2]);
    assert_eq!([x, y, z], [0.0, 0.0, 1.0]);
    assert_eq!(
        angle.to_bits(),
        ANGLE_MARGIN_ULPS as u64,
        "zero, the margin up"
    );
}

#[test]
fn no_face_or_cancelling_faces_leave_the_cone_open() {
    let pos = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    assert_eq!(triangle_cone(&pos, &[]), OPEN_CONE);
    assert_eq!(triangle_cone(&pos, &[0, 0, 1, 2, 2, 2]), OPEN_CONE);
    assert_eq!(triangle_cone(&pos, &[0, 1, 2, 0, 2, 1]), OPEN_CONE);
}

#[test]
fn each_cluster_gets_the_cone_of_its_own_triangles() {
    let pos = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    let indices = [0, 1, 2, 0, 3, 1, 0, 2, 3];
    let mut out = [0.0; 8];
    assert_eq!(
        cluster_cones(&pos, &indices, &[0, 3, 3, 9], &mut out),
        Some(())
    );
    assert_eq!(out[..4], triangle_cone(&pos, &indices[..3]));
    assert_eq!(out[4..], triangle_cone(&pos, &indices[3..]));
}

#[test]
fn a_range_or_an_index_outside_the_input_writes_nothing() {
    let pos = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let mut out = [7.0; 4];
    assert_eq!(cluster_cones(&pos, &[0, 1, 3], &[0, 3], &mut out), None);
    assert_eq!(cluster_cones(&pos, &[0, 1, 2], &[0, 6], &mut out), None);
    assert_eq!(cluster_cones(&pos, &[0, 1, 2], &[3, 0], &mut out), None);
    assert_eq!(
        cluster_cones(&pos, &[0, 1, 2], &[0, 3, 0, 3], &mut out),
        None
    );
    assert_eq!(out, [7.0; 4]);
}

/// The equivalence (CMP-03) on bumpy sheets to free clouds, signed zeros and
/// non-finite positions: the cone holds every face and is never looser than the mean one, which
/// it is bit for bit when not narrower.
#[test]
fn a_random_mesh_gets_a_cone_holding_every_face_never_looser_than_the_mean_one() {
    let mut state = 0x2545_f491_4f6c_dd1du64;
    let mut next = move || {
        (trillion3d_math::random::xorshift64(&mut state) >> 40) as f32 / (1u32 << 23) as f32 - 1.0
    };
    let mut narrowed = 0;
    let odd = [0.0, -0.0, f32::NAN, f32::INFINITY, f32::MAX];
    for case in 0..400 {
        let (bump, vertices) = ([0.05, 0.3, 1.0, 10.0][case % 4], 3 + case % 40);
        let mut pos: Vec<f32> = (0..vertices)
            .flat_map(|_| [next() * 4.0, next() * 4.0, next() * bump])
            .collect();
        if case % 7 == 0 {
            let at = case % pos.len();
            pos[at] = odd[case / 7 % 5];
        }
        let indices: Vec<u32> = (0..vertices as u32 * 3)
            .map(|i| (i * 7 + i / 5) % vertices as u32)
            .collect();
        let (cone, mean) = (
            triangle_cone(&pos, &indices),
            mean_cone(&faces(&pos, &indices)),
        );
        if cone[3] < mean[3] {
            narrowed += 1;
            assert!(holds(cone, &pos, &indices), "case {case}: {cone:?}");
        } else {
            assert_eq!(
                cone.map(f64::to_bits),
                mean.map(f64::to_bits),
                "case {case}"
            );
        }
    }
    assert!(narrowed > 80, "{narrowed} cones narrowed");
}
