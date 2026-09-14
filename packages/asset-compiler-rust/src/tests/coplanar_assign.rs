use crate::coplanar::assign::{self, Overlap};
use crate::coplanar::Surface;

// Comportement 7 : assign::layers donne le plus long chemin de recouvrements, pas un rang : deux
// surfaces disjointes au-dessus d'une même surface partagent la couche 1.

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
    assert_eq!(assigned[0], 0, "le sol ne recouvre rien : couche 0");
    assert_eq!(
        assigned[1], 1,
        "un seul recouvrement au-dessus du sol : couche 1"
    );
    assert_eq!(
        assigned[2], 1,
        "deux surfaces disjointes au-dessus du même sol partagent la couche 1"
    );
}

// Comportement 8 : assign::layers respecte coplanarPriority avant l'aire, et l'ordre source à
// aire égale.
#[test]
fn assign_layers_respects_priority_over_area() {
    // La grande surface (aire 100) a une priorité plus haute que la petite (aire 1) : sans
    // priorité elle resterait dessous, avec priorité elle passe dessus.
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
        "priorité 0 : la petite surface reste dessous malgré son aire"
    );
    assert_eq!(
        assigned[0], 1,
        "priorité 5 : la grande surface passe dessus malgré son aire"
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
        "l'objet source le plus ancien reste dessous à aire égale"
    );
    assert_eq!(
        assigned[1], 1,
        "l'objet source le plus récent passe dessus à aire égale"
    );
}

// Comportement 9 : assign::layers plafonne à 15 et compte le débordement.
#[test]
fn assign_layers_caps_at_fifteen_and_counts_the_overflow() {
    // Une chaîne de 18 surfaces, chacune posée sur la précédente, aires strictement décroissantes
    // pour fixer l'ordre sans ambiguïté.
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
        "sous le plafond, la couche suit la profondeur de la chaîne"
    );
    assert_eq!(
        assigned[15], 15,
        "à la limite : couche 15, pas encore de débordement"
    );
    assert_eq!(assigned[16], 15, "au-delà : plafonné à 15");
    assert_eq!(assigned[17], 15, "toujours plafonné à 15");
    assert_eq!(
        overflow, 2,
        "deux surfaces (16 et 17) ont dépassé le plafond"
    );
}
