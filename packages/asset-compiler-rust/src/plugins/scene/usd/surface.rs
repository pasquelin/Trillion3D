//! Les tableaux d'un `Mesh`, et la primitive glTF qu'une partie de matériau en tire.
//!
//! Les polygones sont triangulés par oreilles dans le plan de leur normale, ce qui conserve l'aire
//! et la silhouette d'une face concave comme d'une face convexe. Le sens de parcours suit
//! `orientation` : `rightHanded`, la valeur par défaut de USD, est déjà celui de
//! glTF ; `leftHanded` renverse chaque triangle plutôt que de retourner les normales. Les
//! coordonnées de texture passent de l'origine en bas à gauche de USD à celle de glTF, en haut.
use super::*;
use crate::import::{primitive, Vertices};
use crate::plugins::scene::ngon::Ngon;

/// Les tableaux d'une surface, lus une fois pour toutes ses parties.
pub(super) struct Surface {
    points: Vec<[f32; 3]>,
    corners: Vec<i64>,
    /// Le rang du premier coin de chaque face, et son nombre de coins.
    faces: Vec<(usize, usize)>,
    normals: Option<primvar::Primvar<[f32; 3]>>,
    uvs: Option<primvar::Primvar<[f32; 2]>>,
    reversed: bool,
}

impl Surface {
    pub(super) fn read(
        world: &mut World<'_>,
        prim: &usd::Prim,
        points: Vec<[f32; 3]>,
        corners: Vec<i64>,
        faces: Vec<(usize, usize)>,
    ) -> Self {
        let (count, corner_count) = (points.len(), corners.len());
        let normals =
            primvar::read(prim, "normals", read::triples, count, corner_count).or_else(|| {
                primvar::read(prim, "primvars:normals", read::triples, count, corner_count)
            });
        let uvs = primvar::read(prim, "primvars:st", read::pairs, count, corner_count);
        let sampled =
            normals.as_ref().is_some_and(|(_, s)| *s) || uvs.as_ref().is_some_and(|(_, s)| *s);
        if sampled {
            world.refuse(world::TIME_SAMPLE);
        }
        Self {
            points,
            corners,
            faces,
            normals: normals.map(|(primvar, _)| primvar),
            uvs: uvs.map(|(primvar, _)| primvar),
            reversed: mesh::scheme(prim, "orientation").as_deref() == Some("leftHanded"),
        }
    }

    /// Une partie de matériau en primitive glTF, avec son nombre de triangles.
    pub(super) fn part(
        &self,
        world: &mut World<'_>,
        part: &subset::Part,
    ) -> Option<(Value, usize)> {
        let mut out = Vertices::default();
        let mut unique: HashMap<[u32; 3], u32> = HashMap::new();
        // Un seul anneau et un seul découpeur, vidés d'une face à l'autre : la boucle passe sur
        // chaque face de la partie, et une allocation par face ne referait que le même tampon.
        let mut corners: Vec<u32> = Vec::new();
        let mut cutter = Ngon::default();
        let cancelled = world.cancelled;
        for face in &part.faces {
            let Some((start, count)) = self.faces.get(*face).copied() else {
                continue;
            };
            corners.clear();
            corners
                .extend((0..count).filter_map(|offset| {
                    self.corner(&mut out, &mut unique, start + offset, *face)
                }));
            // Moins de trois coins, ou un coin que les tableaux ne portent pas : la face n'est
            // pas une surface, elle sort de la scène et son compte le dit.
            if corners.len() < 3 || corners.len() < count {
                world.refuse(world::FACE_INVALID);
                continue;
            }
            cutter.begin();
            for offset in 0..count {
                cutter.corner(self.point(start + offset));
            }
            // Le découpeur relit le jeton par tranche de faces : un seul maillage énorme s'arrête
            // aussi. Ce qui est posé reste en place, et `convert` refuse la scène entière ensuite.
            match cutter.cut(cancelled) {
                None => break,
                Some(false) => world.refuse(world::NGON_UNCUT),
                Some(true) => {}
            }
            for [a, b, c] in cutter.triangles() {
                match self.reversed {
                    true => out.indices.extend([corners[*a], corners[*c], corners[*b]]),
                    false => out.indices.extend([corners[*a], corners[*b], corners[*c]]),
                }
            }
        }
        if out.indices.is_empty() {
            return None;
        }
        let triangles = out.indices.len() / 3;
        let scene = &mut world.scene;
        let value = primitive(&out, &mut scene.bin, &mut scene.accessors, part.material);
        Some((value, triangles))
    }

    /// La position d'un coin, en double, telle que le découpage du polygone la lit. Un coin hors
    /// des tables donne l'origine : `corner` a déjà écarté la face dont les tableaux se contredisent.
    fn point(&self, corner: usize) -> [f64; 3] {
        self.point_index(corner)
            .and_then(|rank| self.points.get(rank))
            .map_or([0.0; 3], |axes| axes.map(f64::from))
    }

    /// Le rang du point qu'un coin désigne, quand les tables portent ce coin et que son indice est
    /// un rang : c'est la seule lecture de `corners` du découpage.
    fn point_index(&self, corner: usize) -> Option<usize> {
        usize::try_from(*self.corners.get(corner)?).ok()
    }

    /// Le sommet glTF d'un coin de face, créé à sa première rencontre. Rien n'est écrit tant que
    /// les trois attributs du sommet ne sont pas tous lus : un tableau trop court écarte le coin,
    /// il ne laisse pas un sommet à moitié dans le tampon.
    fn corner(
        &self,
        out: &mut Vertices,
        unique: &mut HashMap<[u32; 3], u32>,
        corner: usize,
        face: usize,
    ) -> Option<u32> {
        let point = self.point_index(corner)?;
        let normal = match self.normals.as_ref() {
            Some(values) => Some(values.slot(corner, face, point)?),
            None => None,
        };
        let uv = match self.uvs.as_ref() {
            Some(values) => Some(values.slot(corner, face, point)?),
            None => None,
        };
        let key = [
            u32::try_from(point).ok()?,
            normal.unwrap_or(0),
            uv.unwrap_or(0),
        ];
        if let Some(known) = unique.get(&key) {
            return Some(*known);
        }
        let position = *self.points.get(point)?;
        let normal = match (&self.normals, normal) {
            (Some(values), Some(slot)) => Some(unit(values.get(slot)?)),
            _ => None,
        };
        let uv = match (&self.uvs, uv) {
            (Some(values), Some(slot)) => {
                let [u, v] = values.get(slot)?;
                Some([u, 1.0 - v])
            }
            _ => None,
        };
        let id = u32::try_from(unique.len()).ok()?;
        out.positions.extend(position);
        if let Some(normal) = normal {
            out.normals.extend(normal);
        }
        if let Some(uv) = uv {
            out.uvs.extend(uv);
        }
        unique.insert(key, id);
        Some(id)
    }
}

/// Une normale ramenée à la longueur un ; une normale nulle devient l'axe haut de glTF.
fn unit([x, y, z]: [f32; 3]) -> [f32; 3] {
    let unit = crate::shared_math::normalized_or(
        [f64::from(x), f64::from(y), f64::from(z)],
        [0.0, 1.0, 0.0],
    );
    unit.map(|part| part as f32)
}
