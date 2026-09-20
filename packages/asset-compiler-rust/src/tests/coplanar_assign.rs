use crate::coplanar::assign::{self, Overlap};
use crate::coplanar::Surface;

// Behavior 7: assign::layers yields longest overlap path, not rank: two
// disjoint surfaces above same surface share layer 1.

fn bare_surface(area: f64, priority: i64, order: usize, primitive: usize) -> Surface {
    Surface {
        node: primitive,
        mesh: primitive,
        primitive,
        material: -1,
        priority,
        order,
        normal: [0., 0., 1.],
        offset: 0.0,
        key: [0, 0, 0, 0],
        area,
        low: [0., 0., 0.],
        high: [1., 1., 0.],
        pages: vec![0],
        exact_pages: 1,
    }
}

#[test]
fn assign_layers_gives_the_longest_overlap_chain_not_a_rank() {
    let floor = bare_surface(100.0, 0, 0, 0);
    let overlay_a = bare_surface(10.0, 0, 1, 1);
    let overlay_b = bare_surface(8.0, 0, 2, 2);
    let surfaces = vec![floor, overlay_a, overlay_b];
    let overlaps = vec![
        Overlap {
            a: 0,
            b: 1,
            cells: 5,
            area: 1.0,
        },
        Overlap {
            a: 0,
            b: 2,
            cells: 5,
            area: 1.0,
        },
    ];
    let (assigned, overflow) = assign::layers(&surfaces, &overlaps, 15);
    assert_eq!(overflow, 0);
    assert_eq!(assigned[0], 0, "the ground covers nothing: layer 0");
    assert_eq!(assigned[1], 1, "a single overlap above the ground: layer 1");
    assert_eq!(
        assigned[2], 1,
        "two disjoint surfaces above the same ground share layer 1"
    );
}

// Behavior 8: assign::layers respects coplanarPriority before area, and source order at
// equal area.
#[test]
fn assign_layers_respects_priority_over_area() {
    // Large surface (area 100) higher priority than small (area 1): without
    // priority stays below, with priority passes above.
    let big_but_low_priority = bare_surface(100.0, 5, 0, 0);
    let small_but_high_priority = bare_surface(1.0, 0, 1, 1);
    let surfaces = vec![big_but_low_priority, small_but_high_priority];
    let overlaps = vec![Overlap {
        a: 0,
        b: 1,
        cells: 5,
        area: 1.0,
    }];
    let (assigned, _) = assign::layers(&surfaces, &overlaps, 15);
    assert_eq!(
        assigned[1], 0,
        "priority 0: the small surface stays underneath despite its area"
    );
    assert_eq!(
        assigned[0], 1,
        "priority 5: the large surface goes on top despite its area"
    );
}

#[test]
fn assign_layers_breaks_area_ties_by_source_order() {
    let earlier = bare_surface(10.0, 0, 0, 0);
    let later = bare_surface(10.0, 0, 1, 1);
    let surfaces = vec![earlier, later];
    let overlaps = vec![Overlap {
        a: 0,
        b: 1,
        cells: 5,
        area: 1.0,
    }];
    let (assigned, _) = assign::layers(&surfaces, &overlaps, 15);
    assert_eq!(
        assigned[0], 0,
        "the oldest source object stays underneath at equal area"
    );
    assert_eq!(
        assigned[1], 1,
        "the newest source object goes on top at equal area"
    );
}

// Behavior 9: assign::layers caps at 15 and counts overflow.
#[test]
fn assign_layers_caps_at_fifteen_and_counts_the_overflow() {
    // Chain of 18 surfaces, each placed on previous, strictly decreasing areas
    // to fix order unambiguously.
    let surfaces: Vec<Surface> = (0..18)
        .map(|i| bare_surface(100.0 - i as f64, 0, i, i))
        .collect();
    let overlaps: Vec<Overlap> = (0..17)
        .map(|i| Overlap {
            a: i,
            b: i + 1,
            cells: 5,
            area: 1.0,
        })
        .collect();
    let (assigned, overflow) = assign::layers(&surfaces, &overlaps, 15);
    assert_eq!(
        assigned[14], 14,
        "under the ceiling, the layer follows the chain depth"
    );
    assert_eq!(
        assigned[15], 15,
        "at the limit: layer 15, not yet overflowing"
    );
    assert_eq!(assigned[16], 15, "beyond: capped at 15");
    assert_eq!(assigned[17], 15, "still capped at 15");
    assert_eq!(overflow, 2, "two surfaces (16 and 17) exceeded the ceiling");
}
