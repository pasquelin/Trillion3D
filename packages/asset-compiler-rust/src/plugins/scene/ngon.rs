//! La triangulation d'un polygone quelconque, partagée par les pilotes qui lisent des n-gones.
//!
//! Un éventail depuis le premier coin ajoute de la surface dès que le polygone est concave : ses
//! triangles sortent de la face, et l'aire rendue dépasse l'aire écrite — un polygone en U d'aire
//! sept en rend onze. Les oreilles, elles, ne coupent que des triangles dont l'intérieur est vide :
//! l'aire et la silhouette d'un polygone simple sont conservées exactement. Sur un polygone
//! convexe, la coupe retombe coin par coin sur l'éventail, donc la sortie d'une scène convexe ne
//! bouge pas d'un indice.
//!
//! Le polygone est lu dans son propre plan, celui de sa normale de Newell : l'axe dominant de cette
//! normale est laissé de côté, et les deux autres portent le découpage. Un polygone sans plan —
//! sommets tous alignés, aire nulle, coordonnées non finies — n'a pas d'oreille à couper : il sort
//! en éventail, et la coupe le dit à l'appelant, qui le compte sous son propre nom.
#[cfg(test)]
mod tests;
use super::cancel;
use std::sync::atomic::AtomicBool;

/// Un découpeur réutilisable : l'anneau, sa projection, les rangs encore vivants et les triangles
/// servent d'une face à l'autre, pour qu'un maillage de mille faces n'alloue pas mille fois.
#[derive(Default)]
pub(super) struct Ngon {
    ring: Vec<[f64; 3]>,
    flat: Vec<[f64; 2]>,
    alive: Vec<usize>,
    triangles: Vec<[usize; 3]>,
    /// Les faces que ce découpeur a déjà coupées : c'est ce compte qui borne la relecture du jeton
    /// d'annulation, une fois par tranche.
    done: usize,
}

impl Ngon {
    /// Ouvre un anneau vide : les coins se donnent ensuite dans l'ordre du polygone.
    pub(super) fn begin(&mut self) {
        self.ring.clear();
    }

    /// Ajoute un coin à l'anneau ouvert.
    pub(super) fn corner(&mut self, point: [f64; 3]) {
        self.ring.push(point);
    }

    /// Découpe l'anneau. Rend `None` quand le jeton d'annulation est levé : le découpeur le relit
    /// lui-même, par tranche de faces, pour qu'un seul maillage énorme s'arrête aussi, et aucun
    /// pilote n'a à s'en souvenir. Rend `Some(false)` quand une oreille a manqué — polygone qui se
    /// recoupe, ou sans plan : les triangles rendus retombent alors sur l'éventail, et l'appelant
    /// compte la face.
    pub(super) fn cut(&mut self, cancelled: &AtomicBool) -> Option<bool> {
        if cancel::stopped(cancelled, self.done) {
            return None;
        }
        self.done += 1;
        self.triangles.clear();
        if self.ring.len() < 3 {
            return Some(true);
        }
        let Some(turn) = self.project() else {
            self.fan();
            return Some(false);
        };
        self.alive.clear();
        self.alive.extend(0..self.ring.len());
        let mut exact = true;
        let mut at = 1;
        while self.alive.len() > 3 {
            let found = (0..self.alive.len())
                .map(|step| (at + step) % self.alive.len())
                .find(|rank| self.is_ear(*rank, turn));
            let rank = found.unwrap_or_else(|| self.widest(turn));
            exact &= found.is_some();
            let (before, after) = self.neighbours(rank);
            self.triangles
                .push([self.alive[before], self.alive[rank], self.alive[after]]);
            self.alive.remove(rank);
            at = rank % self.alive.len();
        }
        self.triangles
            .push([self.alive[0], self.alive[1], self.alive[2]]);
        Some(exact)
    }

    /// Les triangles de la dernière coupe, en rangs de coins de l'anneau.
    pub(super) fn triangles(&self) -> &[[usize; 3]] {
        &self.triangles
    }

    /// L'éventail depuis le premier coin : ce que rend un anneau sans plan, faute de mieux.
    fn fan(&mut self) {
        for step in 1..self.ring.len() - 1 {
            self.triangles.push([0, step, step + 1]);
        }
    }

    /// Projette l'anneau dans le plan de sa normale de Newell et rend le sens de son parcours dans
    /// cette projection : `1.0` pour le sens direct, `-1.0` pour l'autre. `None` quand le polygone
    /// n'a ni normale ni aire : il n'y a alors aucun plan où le découper.
    fn project(&mut self) -> Option<f64> {
        let normal = newell(&self.ring);
        let axis = (0..3).fold(0, |best, axis| {
            match normal[axis].abs() > normal[best].abs() {
                true => axis,
                false => best,
            }
        });
        if !normal[axis].is_finite() || normal[axis] == 0.0 {
            return None;
        }
        let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
        self.flat.clear();
        self.flat
            .extend(self.ring.iter().map(|point| [point[u], point[v]]));
        // L'aire signée de la projection est la composante `axis` de la normale de Newell, déjà
        // finie et non nulle : son signe est le sens de parcours.
        Some(normal[axis].signum())
    }

    /// Les rangs qui encadrent un rang vivant.
    fn neighbours(&self, rank: usize) -> (usize, usize) {
        let sides = self.alive.len();
        ((rank + sides - 1) % sides, (rank + 1) % sides)
    }

    /// Le triangle d'un rang vivant, dans le plan du découpage.
    fn ear(&self, rank: usize) -> [[f64; 2]; 3] {
        let (before, after) = self.neighbours(rank);
        [
            self.flat[self.alive[before]],
            self.flat[self.alive[rank]],
            self.flat[self.alive[after]],
        ]
    }

    /// Ce rang est-il une oreille ? Son coin ne doit pas rentrer dans le polygone, et aucun autre
    /// sommet vivant ne doit tomber dans son triangle, bord compris : un sommet posé sur la diagonale
    /// y reste après la coupe, du mauvais côté du bord restant, et le triangle suivant part à
    /// l'envers. Un coin aligné ou doublé passe : son triangle est d'aire nulle, donc il n'ajoute
    /// aucune surface, ne contient rien, et la coupe avance toujours.
    fn is_ear(&self, rank: usize, turn: f64) -> bool {
        let [a, b, c] = self.ear(rank);
        let area = turn * side(a, b, c);
        if area < 0.0 {
            return false;
        }
        if area == 0.0 {
            return true;
        }
        let (before, after) = self.neighbours(rank);
        let corners = [self.alive[before], self.alive[rank], self.alive[after]];
        !self.alive.iter().any(|other| {
            !corners.contains(other) && {
                let point = self.flat[*other];
                ![a, b, c].contains(&point)
                    && turn * side(a, b, point) >= 0.0
                    && turn * side(b, c, point) >= 0.0
                    && turn * side(c, a, point) >= 0.0
            }
        })
    }

    /// Le rang le plus saillant, coupé de force quand aucune oreille ne se présente : un polygone
    /// qui se recoupe n'en a pas, et la coupe doit finir. Le premier l'emporte à égalité.
    fn widest(&self, turn: f64) -> usize {
        let saliency = |rank: &usize| {
            let [a, b, c] = self.ear(*rank);
            turn * side(a, b, c)
        };
        (0..self.alive.len())
            .rev()
            .max_by(|x, y| saliency(x).total_cmp(&saliency(y)))
            .unwrap_or_default()
    }
}

/// La somme de Newell d'un anneau : un vecteur normal au polygone, de longueur double de son aire.
/// La formule vaut pour une face quelconque, plane ou non, et ne suppose aucune convexité.
pub(super) fn newell(ring: &[[f64; 3]]) -> [f64; 3] {
    let mut sum = [0.0f64; 3];
    for (rank, here) in ring.iter().enumerate() {
        let next = ring[(rank + 1) % ring.len()];
        for (axis, part) in sum.iter_mut().enumerate() {
            let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
            *part += (here[u] - next[u]) * (here[v] + next[v]);
        }
    }
    sum
}

/// Le produit vectoriel de deux points du plan : deux fois l'aire signée du triangle qu'ils ferment
/// avec l'origine.
fn cross([x0, y0]: [f64; 2], [x1, y1]: [f64; 2]) -> f64 {
    x0 * y1 - y0 * x1
}

/// De quel côté du segment `from`–`to` tombe un point : deux fois l'aire signée de leur triangle.
fn side(from: [f64; 2], to: [f64; 2], point: [f64; 2]) -> f64 {
    let edge = [to[0] - from[0], to[1] - from[1]];
    cross(edge, [point[0] - from[0], point[1] - from[1]])
}
