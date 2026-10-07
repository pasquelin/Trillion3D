use crate::impostor::eligibility::FRAMES;
use crate::impostor::octahedron::{cell_weights, frame_direction};
use trillion3d_math::octahedral::{octahedral_decode as decode, octahedral_encode as encode};

// Behaviour: on every lattice vertex of both mappings, direction → uv → direction comes back
// within 1e-6, the lower half of the full octahedron and the hemi's horizon included.
#[test]
fn both_mappings_round_trip_on_the_lattice() {
    for hemi in [false, true] {
        for n in [FRAMES, 2, 3, 16] {
            for (i, j) in (0..n).flat_map(|i| (0..n).map(move |j| (i, j))) {
                let d = frame_direction((i, j), n, hemi);
                let uv = encode(d, hemi);
                let back = decode(uv.map(|x| x * 0.5 + 0.5), hemi);
                let gap = (0..3).map(|k| (back[k] - d[k]).abs()).fold(0.0, f64::max);
                assert!(
                    gap <= 1e-6,
                    "hemi {hemi}, n {n}, frame ({i}, {j}): {d:?} came back {back:?}"
                );
            }
        }
    }
    // The full octahedron reaches straight down; the hemi covers the upper half only.
    assert!(frame_direction((0, 0), FRAMES, false)[1] < -0.999);
    assert!((0..FRAMES).all(|i| frame_direction((i, 0), FRAMES, true)[1] >= 0.0));
}

// Behaviour: the three-frame weights sum to 1 on both triangles of a cell, and each is the
// barycentric coordinate of the view's grid position in its triangle.
#[test]
fn the_three_frame_weights_sum_to_one_on_both_triangles() {
    let n = FRAMES;
    for (fx, fy) in [(0.7, 0.2), (0.2, 0.7), (0.5, 0.5), (0.0, 0.0), (0.99, 0.01)] {
        for cell in [(0.0, 0.0), (4.0, 7.0), ((n - 2) as f64, (n - 2) as f64)] {
            let g = [cell.0 + fx, cell.1 + fy];
            let frames = cell_weights(g, n);
            let sum: f64 = frames.iter().map(|(_, w)| w).sum();
            assert!((sum - 1.0).abs() <= 1e-12, "weights at {g:?} sum to {sum}");
            assert!(frames.iter().all(|(_, w)| *w >= 0.0));
            let back = [0, 1].map(|a| {
                let axis = |(i, j): (usize, usize)| [i, j][a] as f64;
                frames.iter().map(|(f, w)| axis(*f) * w).sum::<f64>()
            });
            assert!((back[0] - g[0]).abs() <= 1e-12 && (back[1] - g[1]).abs() <= 1e-12);
            let middle = frames[1].0;
            let expected = if fx > fy {
                (cell.0 as usize + 1, cell.1 as usize)
            } else {
                (cell.0 as usize, cell.1 as usize + 1)
            };
            assert_eq!(middle, expected);
        }
    }
    // The last row and column blend inside the grid.
    let edge = cell_weights([(n - 1) as f64, (n - 1) as f64], n);
    assert!(edge.iter().all(|((i, j), _)| *i < n && *j < n));
}
