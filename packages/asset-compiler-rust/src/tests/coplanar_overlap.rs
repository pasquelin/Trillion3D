use super::*;
use crate::coplanar::overlap::{cover, shared, Footprint, Rect};

// Comportement 6 : cover/shared comptent les cellules communes et ignorent deux surfaces qui ne
// se touchent que par un bord.

fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> Footprint {
  Footprint {
    points: vec![[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]],
  }
}

#[test]
fn cover_and_shared_count_the_cells_two_surfaces_really_share() {
  // Deux carrés qui se recouvrent sur le quart [3,6]x[3,6] : chaque cellule de la zone commune a
  // son centre dans les deux carrés, donc `shared` compte la grille entière.
  let a = square(0.0, 0.0, 6.0, 6.0);
  let b = square(3.0, 3.0, 9.0, 9.0);
  let rect: Rect = ([3.0, 3.0], [6.0, 6.0]);
  let grid = 6usize;
  let mut buffer_a = vec![0u64; (grid * grid + 63) / 64];
  let mut buffer_b = vec![0u64; (grid * grid + 63) / 64];
  cover(&a, &rect, grid, &mut buffer_a);
  cover(&b, &rect, grid, &mut buffer_b);
  assert_eq!(shared(&buffer_a, &buffer_b), grid * grid);
}

#[test]
fn cover_and_shared_ignore_two_triangles_that_only_touch_along_an_edge() {
  // Deux triangles qui pavent le carré [0,4.3]x[0,4.3] de part et d'autre de l'hypoténuse
  // x+y=4.3 : ils ne se recouvrent nulle part, seulement ce bord. 4.3 n'est jamais la somme de
  // deux demi-entiers, donc aucun centre de cellule ne tombe exactement sur ce bord.
  let a = Footprint { points: vec![[0.0, 0.0], [4.3, 0.0], [0.0, 4.3]] };
  let b = Footprint { points: vec![[4.3, 0.0], [4.3, 4.3], [0.0, 4.3]] };
  let rect: Rect = ([0.0, 0.0], [10.0, 10.0]);
  let grid = 10usize;
  let mut buffer_a = vec![0u64; (grid * grid + 63) / 64];
  let mut buffer_b = vec![0u64; (grid * grid + 63) / 64];
  cover(&a, &rect, grid, &mut buffer_a);
  cover(&b, &rect, grid, &mut buffer_b);
  assert!(shared(&buffer_a, &buffer_b) == 0, "un bord commun ne partage aucune cellule");
  // Les deux triangles couvrent bel et bien des cellules, sinon le test serait vide de sens.
  assert!(buffer_a.iter().any(|word| *word != 0));
  assert!(buffer_b.iter().any(|word| *word != 0));
}
