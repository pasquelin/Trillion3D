//! Le découpage d'une surface en parties de matériau, et la primitive glTF que chacune donne.
//!
//! Un `shadingEngine` réclame soit le maillage entier, soit les faces que sa liste de composants
//! nomme. Une liaison entière ne prend donc que ce qu'aucune liaison par faces n'a pris : c'est
//! ainsi qu'un maillage à plusieurs matériaux rend plusieurs primitives, sans qu'aucune face ne
//! soit dessinée deux fois.
//!
//! Une primitive glTF porte ses attributs pour tous ses sommets ou pour aucun. Une part dont une
//! face seulement porte des coordonnées de texture n'en porte donc aucune, et l'écart est compté :
//! donner `(0, 0)` aux autres inventerait un placage que le fichier n'écrit pas.
use super::*;
use crate::import::{primitive, Vertices};

/// Une part de matériau : son matériau glTF, et les faces qu'elle porte.
struct Part {
    material: Option<usize>,
    faces: Vec<usize>,
}

/// Écrit les primitives de la surface et pose le maillage dans la table.
pub(super) fn emit(world: &mut World<'_>, node: usize, surface: &Surface) -> Option<usize> {
    let mut primitives = Vec::new();
    let mut triangles = 0usize;
    for part in parts(world, node, surface.loops.len()) {
        let Some((value, count)) = build(world, surface, &part) else {
            continue;
        };
        triangles += count;
        primitives.push(value);
    }
    if primitives.is_empty() {
        world.refuse(report::MESH_EMPTY);
        return None;
    }
    let name = world.document.nodes[node].name.clone();
    world
        .scene
        .meshes
        .push(json!({"name":name,"primitives":primitives}));
    world.scene.mesh_triangles.push(triangles);
    Some(world.scene.meshes.len() - 1)
}

/// Les parts de ce maillage. Sans aucune liaison, une seule part sans matériau porte toutes les
/// faces : un maillage qu'aucun ensemble ne nuance reste visible.
fn parts(world: &mut World<'_>, node: usize, faces: usize) -> Vec<Part> {
    let binds: Vec<(Option<usize>, Option<Vec<usize>>)> = world
        .graph
        .binds
        .get(&node)
        .map(|binds| {
            binds
                .iter()
                .map(|bind| (bind.shader, bind.faces.clone()))
                .collect()
        })
        .unwrap_or_default();
    if binds.is_empty() {
        return vec![Part {
            material: None,
            faces: (0..faces).collect(),
        }];
    }
    let mut taken = vec![false; faces];
    let mut out = Vec::with_capacity(binds.len());
    for (shader, named) in binds.iter().filter(|(_, named)| named.is_some()) {
        let owned = named
            .iter()
            .flatten()
            .filter(|face| **face < faces && !std::mem::replace(&mut taken[**face], true))
            .copied()
            .collect();
        let material = shader.and_then(|shader| material::resolve(world, shader));
        out.push(Part {
            material,
            faces: owned,
        });
    }
    if let Some((shader, _)) = binds.iter().find(|(_, named)| named.is_none()) {
        let material = shader.and_then(|shader| material::resolve(world, shader));
        out.push(Part {
            material,
            faces: (0..faces).filter(|face| !taken[*face]).collect(),
        });
    }
    out
}

/// Une part en primitive glTF, avec son nombre de triangles.
fn build(world: &mut World<'_>, surface: &Surface, part: &Part) -> Option<(Value, usize)> {
    let textured = !surface.uvs.is_empty()
        && part.faces.iter().all(|face| {
            surface
                .uv_slots
                .get(*face)
                .is_some_and(|slots| !slots.is_empty())
        });
    if !textured && !surface.uvs.is_empty() {
        world.refuse(report::UV_DROPPED);
    }
    let mut out = Vertices::default();
    let mut unique: HashMap<[u32; 3], u32> = HashMap::new();
    for face in &part.faces {
        let ring = surface.loops.get(*face).map_or(0, Vec::len);
        if ring < 3 {
            continue;
        }
        let fan: Vec<u32> = (0..ring)
            .filter_map(|rank| surface.corner(&mut out, &mut unique, (*face, rank), textured))
            .collect();
        if fan.len() != ring {
            continue;
        }
        for step in 1..ring - 1 {
            out.indices.extend([fan[0], fan[step], fan[step + 1]]);
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

impl Surface {
    /// Le sommet glTF d'un coin de face, créé à sa première rencontre. Trois rangs l'identifient :
    /// sa position, sa coordonnée de texture et l'endroit où se lit sa normale. Deux coins qui les
    /// partagent tous les trois sont le même sommet.
    fn corner(
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
            Shading::Face => face,
        };
        let key = [
            vertex,
            uv.and_then(|slot| u32::try_from(slot).ok())
                .unwrap_or(u32::MAX),
            u32::try_from(shade).ok()?,
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
