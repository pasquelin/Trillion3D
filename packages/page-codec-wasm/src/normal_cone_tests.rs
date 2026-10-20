use super::*;

/// `triangle_cone` of the mesh of `a_mesh_takes_the_narrowest_cone`.
const NARROWEST_BITS: [u64; 4] = [
    0xbfcbf36eb7e7de25,
    0xbfe62fc5fca715b1,
    0x3fe5f9bf21ad4e4b,
    0x3ff1d141d54a5f45,
];

/// Whether `cone` holds every non-degenerate face normal of `indices` over `pos`.
fn holds(cone: [f64; 4], pos: &[f32], indices: &[u32]) -> bool {
    widest_angle(
        &faces(&face_crosses(pos, indices)),
        [cone[0], cone[1], cone[2]],
    ) <= cone[3]
}

#[test]
fn a_mesh_takes_the_narrowest_cone() {
    // The last triangle is degenerate and left out. The axis points at the centre of the smallest
    // ball of the unit normals: 0.64 rad narrower than the summed normals' cone of the same faces.
    let pos: [f32; 18] = [
        0.0, 0.0, 0.0, 1.0, 0.0, 0.1, 0.3, 1.0, -0.2, -0.7, 0.4, 0.5, 0.2, -0.9, 0.3, 0.5, 0.5, 0.5,
    ];
    let indices = [0, 1, 2, 0, 2, 3, 0, 4, 1, 1, 5, 2, 0, 0, 1];
    let cone = triangle_cone(&pos, &indices);
    assert_eq!(cone.map(f64::to_bits), NARROWEST_BITS);
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

/// The grid turns a face: a sheet whose heights sit a fraction of a step off zero decodes with one
/// corner a whole step up. The cone of the source's faces then misses the decoded ones; the page's,
/// measured by the encoder on what it decodes to, holds them.
#[test]
fn a_page_takes_the_cone_of_the_faces_it_decodes_to() {
    let pos: [f32; 12] = [
        0.0, 0.0, 0.0, 0.25, 0.0, 0.04, 0.0, 0.25, 0.0, 0.25, 0.25, 0.01,
    ];
    let indices = [0, 1, 2, 2, 1, 3];
    let page = crate::encode::encode(&indices, &pos, &[], -4, 0).expect("encoded");
    let decoded = crate::unpack::decode(&page.bytes, usize::MAX).expect("decoded");
    let (drawn, corners) = (decoded.attribute(0).expect("positions"), decoded.indices());
    assert!(!holds(triangle_cone(&pos, &indices), drawn, corners));
    assert!(holds(page.cone, drawn, corners));
    assert_eq!(page.cone, triangle_cone(drawn, corners));
}

/// Bumpy sheets to free clouds, signed zeros and non-finite positions: the cone holds every face.
#[test]
fn a_random_mesh_gets_a_cone_holding_every_face() {
    let mut state = 0x2545_f491_4f6c_dd1du64;
    let mut next = move || {
        (trillion3d_math::random::xorshift64(&mut state) >> 40) as f32 / (1u32 << 23) as f32 - 1.0
    };
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
        let cone = triangle_cone(&pos, &indices);
        assert!(holds(cone, &pos, &indices), "case {case}: {cone:?}");
        // Never looser than the summed normals' cone: narrower, or open where that one is too wide
        // to cull anything.
        let faces = faces(&face_crosses(&pos, &indices));
        let sum = faces.iter().fold([0.0; 3], |s, &(c, len)| {
            [0, 1, 2].map(|k| s[k] + c[k] / len)
        });
        let length = hypot(sum);
        if faces.is_empty() || !(length > 1e-9) {
            continue;
        }
        let mean = raised_cone(&faces, divide(sum, length));
        let narrower = cone[3] <= mean[3];
        let open = cone == OPEN_CONE && mean[3] >= std::f64::consts::FRAC_PI_2;
        assert!(narrower || open, "case {case}: {cone:?} against {mean:?}");
    }
}
