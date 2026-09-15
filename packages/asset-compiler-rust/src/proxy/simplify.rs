//! Simplification propre au proxy : des triangles de taille bornée, sous un seuil en mètres.
//!
//! La coupe du DAG s'arrête à son niveau racine : quand cette racine pèse déjà plus que le budget,
//! doubler le seuil ne change plus rien et le proxy garde des millions de triangles. Le proxy se
//! simplifie donc lui-même, par une règle qui ne dépend d'aucun DAG : les sommets sont ramenés sur
//! une grille de pas `c`, les triangles dégénérés par ce rapprochement disparaissent, les doublons
//! fusionnent, et ce qui reste plus grand que `c` est redécoupé jusqu'à ce que son plus long côté
//! passe sous `c`.
//!
//! Les deux sens comptent. Vers le bas, la fusion fait tomber le nombre de triangles. Vers le haut,
//! la découpe donne au cache de surfaces des mailles de taille connue : une lumière stockée par
//! triangle n'a de sens que si le triangle est petit devant la pièce qu'il éclaire.
//!
//! L'erreur géométrique ajoutée est bornée par la demi-diagonale d'une maille, publiée avec le
//! proxy. La découpe, elle, est plane : elle n'ajoute aucune erreur.
use super::PROXY_TRIANGLE_FLOATS;
use std::collections::HashSet;

/// Doublements du pas de grille avant d'abandonner : borne connue, comme l'échelle de `cut.rs`.
const CELL_LADDER: usize = 24;
/// Demi-diagonale d'un cube unité : ce dont un sommet peut bouger en rejoignant un coin de maille.
pub const CELL_ERROR_FACTOR: f64 = 0.866_025_403_784_438_6;
/// Découpes d'un seul côté, au plus : une borne connue, pour qu'un triangle géant ne fasse pas
/// exploser le compte pendant la recherche du pas.
const MAX_DIVISIONS: usize = 4096;

/// La maille d'un sommet : trois entiers, le coin le plus proche de la grille de pas `size`.
fn cell_of(vertex: &[f32], size: f64) -> [i32; 3] {
    [
        (vertex[0] as f64 / size).round() as i32,
        (vertex[1] as f64 / size).round() as i32,
        (vertex[2] as f64 / size).round() as i32,
    ]
}

/// Le plus long côté d'un triangle, en mètres.
fn longest_edge(t: &[f32]) -> f64 {
    let point = |i: usize| [t[i * 3] as f64, t[i * 3 + 1] as f64, t[i * 3 + 2] as f64];
    let span = |a: [f64; 3], b: [f64; 3]| {
        ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
    };
    let (a, b, c) = (point(0), point(1), point(2));
    span(a, b).max(span(b, c)).max(span(c, a))
}

/// Les découpes d'un côté : `n` donne `n²` sous-triangles, et `n` reste borné.
fn divisions(edge: f64, size: f64) -> usize {
    if !(edge.is_finite() && size > 0.0) {
        return 1;
    }
    ((edge / size).ceil() as usize).clamp(1, MAX_DIVISIONS)
}

/// Les trois mailles d'un triangle, dans l'ordre canonique : c'est la clé d'un doublon. Un triangle
/// dont deux sommets tombent dans la même maille n'a plus de surface et disparaît.
fn key_of(t: &[f32], size: f64) -> Option<[[i32; 3]; 3]> {
    let cells = [
        cell_of(&t[0..3], size),
        cell_of(&t[3..6], size),
        cell_of(&t[6..9], size),
    ];
    if cells[0] == cells[1] || cells[1] == cells[2] || cells[2] == cells[0] {
        return None;
    }
    let mut sorted = cells;
    sorted.sort_unstable();
    Some(sorted)
}

/// Le triangle ramené sur la grille, sommet par sommet.
fn snap(t: &[f32], size: f64) -> [f32; PROXY_TRIANGLE_FLOATS] {
    let mut out = [0f32; PROXY_TRIANGLE_FLOATS];
    for vertex in 0..3 {
        let cell = cell_of(&t[vertex * 3..vertex * 3 + 3], size);
        for axis in 0..3 {
            out[vertex * 3 + axis] = (cell[axis] as f64 * size) as f32;
        }
    }
    out
}

/// Combien de triangles le pas `size` laisserait, sans rien construire. S'arrête au dépassement.
fn count_at(triangles: &[f32], size: f64, budget: usize) -> usize {
    let mut seen: HashSet<[[i32; 3]; 3]> = HashSet::new();
    let mut total = 0usize;
    for t in triangles.as_chunks::<PROXY_TRIANGLE_FLOATS>().0 {
        let Some(key) = key_of(t, size) else { continue };
        if !seen.insert(key) {
            continue;
        }
        let n = divisions(longest_edge(&snap(t, size)), size);
        total = total.saturating_add(n.saturating_mul(n));
        if total > budget {
            return total;
        }
    }
    total
}

/// Le pas de grille le plus fin qui tienne dans le budget de triangles, à partir du plancher publié.
///
/// C'est une règle de taille, sans nom de scène : une petite pièce garde le plancher, une ville en
/// prend un multiple, et celui qu'elle a pris est publié avec le proxy.
pub fn plan_cell(triangles: &[f32], floor: f64, budget: usize) -> f64 {
    let mut size = floor.max(1e-4);
    for _ in 0..CELL_LADDER {
        if count_at(triangles, size, budget) <= budget {
            break;
        }
        size *= 2.0;
    }
    size
}

/// Les sous-triangles d'un triangle découpé en `n` sur chaque côté, posés en barycentriques.
fn subdivide(t: &[f32], n: usize, out: &mut Vec<f32>) {
    let at = |u: f64, v: f64| {
        let w = 1.0 - u - v;
        [0usize, 1, 2].map(|axis| {
            (t[axis] as f64 * w + t[3 + axis] as f64 * u + t[6 + axis] as f64 * v) as f32
        })
    };
    let step = 1.0 / n as f64;
    for row in 0..n {
        for column in 0..(n - row) {
            let (u, v) = (row as f64 * step, column as f64 * step);
            out.extend_from_slice(&at(u, v));
            out.extend_from_slice(&at(u + step, v));
            out.extend_from_slice(&at(u, v + step));
            if column + 1 < n - row {
                out.extend_from_slice(&at(u + step, v));
                out.extend_from_slice(&at(u + step, v + step));
                out.extend_from_slice(&at(u, v + step));
            }
        }
    }
}

/// Ramène le proxy à des triangles de taille bornée par `size`, l'albédo suivant son triangle.
pub fn simplify(triangles: &mut Vec<f32>, albedo: &mut Vec<u32>, size: f64) {
    let mut seen: HashSet<[[i32; 3]; 3]> = HashSet::new();
    let mut out: Vec<f32> = Vec::with_capacity(triangles.len());
    let mut colours: Vec<u32> = Vec::with_capacity(albedo.len());
    for (index, t) in triangles
        .as_chunks::<PROXY_TRIANGLE_FLOATS>()
        .0
        .iter()
        .enumerate()
    {
        let Some(key) = key_of(t, size) else { continue };
        if !seen.insert(key) {
            continue;
        }
        let snapped = snap(t, size);
        let before = out.len();
        subdivide(&snapped, divisions(longest_edge(&snapped), size), &mut out);
        let colour = albedo.get(index).copied().unwrap_or(0xffff_ffff);
        colours.resize(
            colours.len() + (out.len() - before) / PROXY_TRIANGLE_FLOATS,
            colour,
        );
    }
    *triangles = out;
    *albedo = colours;
}
