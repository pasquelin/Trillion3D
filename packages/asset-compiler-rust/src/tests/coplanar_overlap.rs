use crate::coplanar::overlap::{cover, shared, Footprint, Rect};

// Behavior 6: cover/shared count common cells and ignore two surfaces touching
// only at border.

fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> Footprint {
    Footprint {
        points: vec![[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]],
    }
}

#[test]
fn cover_and_shared_count_the_cells_two_surfaces_really_share() {
    // Two squares overlapping on quarter [3,6]x[3,6]: each cell in common zone has
    // center in both squares, `shared` counts entire grid.
    let a = square(0.0, 0.0, 6.0, 6.0);
    let b = square(3.0, 3.0, 9.0, 9.0);
    let rect: Rect = ([3.0, 3.0], [6.0, 6.0]);
    let grid = 6usize;
    let mut buffer_a = vec![0u64; (grid * grid).div_ceil(64)];
    let mut buffer_b = vec![0u64; (grid * grid).div_ceil(64)];
    cover(&a, &rect, grid, &mut buffer_a);
    cover(&b, &rect, grid, &mut buffer_b);
    assert_eq!(shared(&buffer_a, &buffer_b), grid * grid);
}

#[test]
fn cover_and_shared_ignore_two_triangles_that_only_touch_along_an_edge() {
    // Two triangles tiling square [0,4.3]x[0,4.3] on either side of hypotenuse
    // x+y=4.3: overlap nowhere, only border. 4.3 never sum of
    // two half-integers, so no cell center lands on border.
    let a = Footprint {
        points: vec![[0.0, 0.0], [4.3, 0.0], [0.0, 4.3]],
    };
    let b = Footprint {
        points: vec![[4.3, 0.0], [4.3, 4.3], [0.0, 4.3]],
    };
    let rect: Rect = ([0.0, 0.0], [10.0, 10.0]);
    let grid = 10usize;
    let mut buffer_a = vec![0u64; (grid * grid).div_ceil(64)];
    let mut buffer_b = vec![0u64; (grid * grid).div_ceil(64)];
    cover(&a, &rect, grid, &mut buffer_a);
    cover(&b, &rect, grid, &mut buffer_b);
    assert!(
        shared(&buffer_a, &buffer_b) == 0,
        "a shared edge shares no cell"
    );
    // Both triangles cover cells, test meaningless otherwise.
    assert!(buffer_a.iter().any(|word| *word != 0));
    assert!(buffer_b.iter().any(|word| *word != 0));
}
