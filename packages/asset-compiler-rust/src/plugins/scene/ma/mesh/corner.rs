//! Un coin de face vers un sommet glTF : ce qui l'identifie, et ce qu'il porte.
//!
//! Un sommet glTF ne porte qu'une position, qu'une normale et qu'une coordonnée de texture. Deux
//! coins d'un maillage Maya qui diffèrent par l'un des trois sont donc deux sommets, et deux coins
//! qui les partagent tous les trois n'en font qu'un : c'est cette égalité, jamais un arrondi ni une
//! distance, qui décide de ce qui se fond et de ce qui se dédouble.
use super::*;
use crate::import::Vertices;
use crate::plugins::scene::ngon::Ngon;

impl Surface {
    /// Verse l'anneau d'une face dans le découpeur et le coupe. Rend `None` quand l'annulation
    /// arrête le découpage, `Some(false)` quand la face n'a pas donné toutes ses oreilles : elle
    /// sort alors en éventail, et l'appelant la compte.
    pub(super) fn cut(
        &self,
        cutter: &mut Ngon,
        face: usize,
        cancelled: &AtomicBool,
    ) -> Option<bool> {
        cutter.begin();
        for vertex in self.loops.get(face).map_or(&[][..], Vec::as_slice) {
            let point = self.positions.get(*vertex as usize);
            cutter.corner(point.copied().unwrap_or_default());
        }
        cutter.cut(cancelled)
    }

    /// Le sommet glTF d'un coin de face, créé à sa première rencontre. Trois rangs l'identifient :
    /// sa position, sa coordonnée de texture et sa normale — l'endroit où elle se lit quand le
    /// fichier l'écrit, son groupe de lissage quand ce pilote la calcule. Deux coins qui les
    /// partagent tous les trois sont le même sommet.
    pub(super) fn corner(
        &self,
        out: &mut Vertices,
        unique: &mut HashMap<[u32; 3], u32>,
        (face, rank): (usize, usize),
        textured: bool,
    ) -> Option<u32> {
        let vertex = *self.loops.get(face)?.get(rank)?;
        let uv = textured
            .then(|| self.uv_slots.get(face)?.get(rank).copied())
            .flatten()
            .and_then(|slot| usize::try_from(slot).ok())
            .filter(|slot| *slot < self.uvs.len());
        let shade = match self.shading {
            Shading::Vertex => vertex as usize,
            Shading::Corner => self.bases.get(face)? + rank,
        };
        // Deux coins d'un même groupe de lissage portent la même normale : ils ne font qu'un
        // sommet, et c'est ainsi qu'une arête douce ne se paie pas en sommets doublés.
        let shared = match self.groups.get(shade) {
            Some(group) => *group,
            None => u32::try_from(shade).ok()?,
        };
        let key = [
            vertex,
            uv.and_then(|slot| u32::try_from(slot).ok())
                .unwrap_or(u32::MAX),
            shared,
        ];
        if let Some(known) = unique.get(&key) {
            return Some(*known);
        }
        let id = u32::try_from(unique.len()).ok()?;
        let position = self.positions.get(vertex as usize)?;
        out.positions.extend(position.map(|axis| axis as f32));
        let written = self.normals.get(shade).copied().unwrap_or([0.0, 1.0, 0.0]);
        let normal = crate::shared_math::normalized_or(written, [0.0, 1.0, 0.0]);
        out.normals.extend(normal.map(|axis| axis as f32));
        if textured {
            let [u, v] = uv.map_or([0.0, 0.0], |slot| self.uvs[slot]);
            out.uvs.extend([u as f32, 1.0 - v as f32]);
        }
        unique.insert(key, id);
        Some(id)
    }
}
