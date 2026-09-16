//! Les normales par coin d'un maillage, arêtes dures comprises. Partagée par les pilotes qui
//! calculent leurs normales plutôt que de les lire — `ma` et `blend`.
//!
//! La normale d'une face vient de la formule de Newell, qui vaut pour un polygone quelconque et
//! dont la longueur est le double de l'aire : c'est donc aussi la pondération naturelle d'une
//! moyenne par sommet. Ce qui décide du lissage n'est ni le format ni le type d'objet, mais deux
//! marques que les deux formats écrivent chacun à leur façon : une **face nette** garde sa propre
//! normale sur chacun de ses coins, et une **arête dure** coupe la continuité entre les deux faces
//! qu'elle sépare.
//!
//! Le lissage se lit donc par **éventails** : deux coins d'un même sommet ne se moyennent que s'ils
//! se rejoignent par une suite d'arêtes douces entre faces lisses. Moyenner tous les coins d'un
//! sommet, comme si l'arête n'existait pas, arrondit une arête vive ; n'en moyenner aucun rend une
//! sphère à facettes. Ce sont les deux défauts que ce calcul remplace.
use std::collections::hash_map::Entry;
use std::collections::HashMap;

/// Ce que ce calcul lit d'un maillage. Les deux tableaux de marques sont lus par leur rang quand il
/// y est : un tableau vide dit donc « rien de net », ce qui est le maillage entièrement lisse.
pub(super) struct Surface<'a> {
    /// Trois flottants par sommet.
    pub(super) positions: &'a [f32],
    /// Le sommet de chaque coin.
    pub(super) corners: &'a [u32],
    /// Le premier coin de chaque face, plus la fin du dernier : `faces + 1` valeurs.
    pub(super) offsets: &'a [u32],
    /// La face garde sa propre normale sur tous ses coins.
    pub(super) sharp_faces: &'a [bool],
    /// L'arête qui mène de ce coin au suivant de sa face est dure.
    pub(super) sharp_corners: &'a [bool],
}

/// Les normales de chaque coin, et le groupe de lissage auquel il appartient. Deux coins du même
/// groupe portent exactement la même normale : l'appelant peut n'en écrire qu'un seul sommet.
pub(super) struct Shaded {
    /// Trois flottants par coin.
    pub(super) normals: Vec<f32>,
    /// Un rang de groupe par coin.
    pub(super) groups: Vec<u32>,
}

/// Les normales par coin de cette surface.
pub(super) fn corners(surface: &Surface<'_>) -> Shaded {
    let faces = surface.offsets.len().saturating_sub(1);
    let planes: Vec<[f32; 3]> = (0..faces).map(|face| surface.newell(face)).collect();
    let mut join = Join::new(surface.corners.len());
    surface.weld(&mut join, faces);
    let mut sums = vec![[0.0f32; 3]; surface.corners.len()];
    for (face, plane) in planes.iter().enumerate() {
        for corner in surface.span(face) {
            let into = &mut sums[join.root(corner as u32) as usize];
            for axis in 0..3 {
                into[axis] += plane[axis];
            }
        }
    }
    let mut out = Shaded {
        normals: Vec::with_capacity(surface.corners.len() * 3),
        groups: Vec::with_capacity(surface.corners.len()),
    };
    for (face, plane) in planes.iter().enumerate() {
        let flat = unit(*plane);
        for corner in surface.span(face) {
            let group = join.root(corner as u32);
            let mixed = unit(sums[group as usize]);
            out.normals
                .extend_from_slice(&if mixed == [0.0; 3] { flat } else { mixed });
            out.groups.push(group);
        }
    }
    out
}

impl Surface<'_> {
    /// Les coins d'une face, dans l'ordre du fichier.
    fn span(&self, face: usize) -> std::ops::Range<usize> {
        self.offsets[face] as usize..self.offsets[face + 1] as usize
    }

    /// Réunit les coins que les arêtes douces rejoignent. Une face nette n'y entre pas, une arête
    /// dure est sautée, et une arête que plus de deux faces se partagent n'en réunit aucune : il n'y
    /// a pas d'éventail à y lire, et deviner rendrait un coin au hasard.
    fn weld(&self, join: &mut Join, faces: usize) {
        let mut seen: HashMap<[u32; 2], Option<[u32; 2]>> = HashMap::new();
        for face in (0..faces).filter(|face| !marked(self.sharp_faces, *face)) {
            let span = self.span(face);
            let (first, length) = (span.start, span.len());
            for corner in span.filter(|corner| !marked(self.sharp_corners, *corner)) {
                let next = first + (corner - first + 1) % length;
                let (here, there) = (self.corners[corner], self.corners[next]);
                let side = [corner as u32, next as u32];
                match seen.entry([here.min(there), here.max(there)]) {
                    Entry::Vacant(slot) => {
                        slot.insert(Some(side));
                    }
                    Entry::Occupied(mut slot) => {
                        if let Some(other) = slot.insert(None) {
                            self.pair(join, side, other);
                        }
                    }
                }
            }
        }
    }

    /// Réunit, des deux bouts d'une arête partagée, les coins qui portent le même sommet. Les deux
    /// faces la parcourent d'ordinaire en sens contraire, mais un maillage retourné ne le fait pas :
    /// c'est le sommet qui décide, jamais l'ordre.
    fn pair(&self, join: &mut Join, side: [u32; 2], other: [u32; 2]) {
        for here in side {
            for there in other {
                if self.corners[here as usize] == self.corners[there as usize] {
                    join.unite(here, there);
                }
            }
        }
    }

    /// La somme de Newell d'une face : sa direction normale, de longueur le double de son aire.
    fn newell(&self, face: usize) -> [f32; 3] {
        let span = self.span(face);
        let (first, length) = (span.start, span.len());
        let mut normal = [0.0f32; 3];
        for corner in span {
            let here = self.point(corner);
            let there = self.point(first + (corner - first + 1) % length);
            normal[0] += (here[1] - there[1]) * (here[2] + there[2]);
            normal[1] += (here[2] - there[2]) * (here[0] + there[0]);
            normal[2] += (here[0] - there[0]) * (here[1] + there[1]);
        }
        normal
    }

    /// La position du sommet d'un coin, ou l'origine quand le tableau ne la porte pas.
    fn point(&self, corner: usize) -> [f32; 3] {
        let at = self.corners[corner] as usize * 3;
        self.positions
            .get(at..at + 3)
            .map_or([0.0; 3], |found| [found[0], found[1], found[2]])
    }
}

/// Ce rang est-il marqué ? Un tableau plus court que le domaine ne marque pas ce qu'il ne dit pas.
fn marked(marks: &[bool], rank: usize) -> bool {
    marks.get(rank).copied().unwrap_or(false)
}

/// Le vecteur unitaire, ou le vecteur nul quand il n'y a pas de direction à donner.
fn unit(vector: [f32; 3]) -> [f32; 3] {
    let length = (vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]).sqrt();
    if !length.is_finite() || length == 0.0 {
        return [0.0, 0.0, 0.0];
    }
    [vector[0] / length, vector[1] / length, vector[2] / length]
}

/// L'union-recherche des coins : deux coins réunis sont du même éventail, donc de même normale.
struct Join {
    parent: Vec<u32>,
}

impl Join {
    fn new(count: usize) -> Self {
        Self {
            parent: (0..count as u32).collect(),
        }
    }
    /// Le représentant du groupe de ce coin, le chemin étant raccourci au passage.
    fn root(&mut self, mut node: u32) -> u32 {
        while self.parent[node as usize] != node {
            let up = self.parent[node as usize];
            self.parent[node as usize] = self.parent[up as usize];
            node = self.parent[node as usize];
        }
        node
    }
    /// Réunit deux groupes sous le plus petit de leurs représentants.
    fn unite(&mut self, left: u32, right: u32) {
        let (left, right) = (self.root(left), self.root(right));
        if left != right {
            self.parent[left.max(right) as usize] = left.min(right);
        }
    }
}
