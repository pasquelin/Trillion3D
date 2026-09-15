//! Ce que la coupe par oreilles garantit : l'aire d'un polygone simple, l'éventail sur un polygone
//! convexe, et une sortie comptée plutôt qu'une panique sur un anneau que rien ne rend découpable.
//!
//! L'anneau en U et la mesure d'aire sont ceux des pilotes, dans `crate::tests::ngones` : une seule
//! définition du polygone de l'audit, et une seule façon de mesurer ce qu'il en sort.
use super::*;
use crate::tests::ngones::{cut_area, U_RING};

/// Un anneau plan, posé dans le plan `z = 0`.
fn flat_ring(points: &[[f64; 2]]) -> Vec<[f64; 3]> {
    points.iter().map(|[x, y]| [*x, *y, 0.0]).collect()
}

/// La coupe d'un anneau : ses triangles, et le fait qu'elle soit exacte.
fn cut(ring: &[[f64; 3]]) -> (Vec<[usize; 3]>, bool) {
    let mut ngon = Ngon::default();
    ngon.begin();
    for point in ring {
        ngon.corner(*point);
    }
    let exact = ngon.cut();
    (ngon.triangles().to_vec(), exact)
}

// Comportement : un polygone concave garde exactement son aire. L'éventail depuis le premier coin
// remplissait le creux du U et rendait onze pour sept ; les oreilles ne coupent que des triangles
// vides, donc la somme des aires retombe sur l'aire écrite.
#[test]
fn a_concave_polygon_keeps_its_own_area() {
    let ring = flat_ring(&U_RING);
    let (triangles, exact) = cut(&ring);
    assert!(exact, "un U simple se découpe entièrement en oreilles");
    assert_eq!(triangles.len(), 6, "huit coins font six triangles");
    assert!(
        (cut_area(&ring, &triangles) - 7.0).abs() < 1e-9,
        "{triangles:?}"
    );
    let fan: Vec<[usize; 3]> = (1..7).map(|step| [0, step, step + 1]).collect();
    assert!(
        (cut_area(&ring, &fan) - 11.0).abs() < 1e-9,
        "l'éventail, lui, rendait onze"
    );
}

// Comportement : un polygone convexe est découpé exactement comme l'éventail depuis son premier
// coin, indice par indice. Une scène qui n'a que des faces convexes sort donc inchangée.
#[test]
fn a_convex_polygon_is_cut_exactly_like_the_fan() {
    for sides in 3..12usize {
        let points: Vec<[f64; 2]> = (0..sides)
            .map(|rank| {
                let angle = std::f64::consts::TAU * rank as f64 / sides as f64;
                [angle.cos(), angle.sin()]
            })
            .collect();
        let ring = flat_ring(&points);
        let (triangles, exact) = cut(&ring);
        let fan: Vec<[usize; 3]> = (1..sides - 1).map(|step| [0, step, step + 1]).collect();
        assert!(exact, "{sides} côtés convexes");
        assert_eq!(triangles, fan, "{sides} côtés : la coupe suit l'éventail");
    }
}

// Comportement : des coins alignés ne bloquent pas la coupe. Le carré dont chaque côté porte un
// sommet de plus garde son aire, et l'anneau dont tous les coins sont alignés — aire nulle, aucun
// plan — sort compté plutôt qu'en panique.
#[test]
fn collinear_corners_do_not_stall_the_cut() {
    let square = [
        [0.0, 0.0],
        [1.0, 0.0],
        [2.0, 0.0],
        [2.0, 1.0],
        [2.0, 2.0],
        [0.0, 2.0],
    ];
    let ring = flat_ring(&square);
    let (triangles, exact) = cut(&ring);
    assert!(exact, "un carré à coins alignés reste simple");
    assert!(
        (cut_area(&ring, &triangles) - 4.0).abs() < 1e-9,
        "{triangles:?}"
    );

    let line = flat_ring(&[[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [3.0, 0.0]]);
    let (degenerate, exact) = cut(&line);
    assert!(!exact, "un anneau sans plan est dit non découpable");
    assert_eq!(degenerate.len(), 2, "il sort tout de même en éventail");
    assert!(cut_area(&line, &degenerate) < 1e-12, "d'aire nulle");
}

// Comportement : un anneau qui se recoupe n'a pas toujours d'oreille. La coupe finit quand même,
// rend autant de triangles qu'un éventail, et un anneau de moins de trois coins n'en rend aucun.
#[test]
fn a_self_crossing_ring_is_cut_rather_than_looping() {
    let bow = flat_ring(&[[0.0, 0.0], [2.0, 2.0], [2.0, 0.0], [0.0, 2.0]]);
    assert_eq!(cut(&bow).0.len(), 2, "quatre coins font deux triangles");
    assert_eq!(cut(&[]).0.len(), 0, "un anneau vide ne rend rien");
    assert_eq!(cut(&bow[..2]).0.len(), 0, "deux coins non plus");
}

// Comportement : la somme de Newell d'un anneau plan est normale à son plan, et sa longueur vaut
// deux fois l'aire du polygone — y compris quand il est concave.
#[test]
fn the_newell_sum_measures_the_polygon() {
    let normal = newell(&flat_ring(&U_RING));
    assert_eq!(normal[0], 0.0);
    assert_eq!(normal[1], 0.0);
    assert!((normal[2] - 14.0).abs() < 1e-9, "{normal:?}");
}
