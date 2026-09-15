//! La géométrie d'un `PolyMesh` ou d'un `SubD` telle que le fichier la porte : les positions, la
//! table des faces, et les paramètres de géométrie que ce pilote retient — normales et coordonnées
//! de texture.
//!
//! Un paramètre de géométrie déclare sa **portée** dans sa métadonnée : une valeur par sommet
//! (`vtx`, `var`), une par coin de face (`fvr`), une par face (`uni`), ou une seule pour tout le
//! maillage (`con`). Il est écrit soit en valeurs directes, soit — c'est le cas courant pour des
//! coordonnées de texture — en valeurs uniques plus une table d'indices. Les deux formes se lisent
//! ici de la même façon : un rang par coin, puis la valeur à ce rang.
use super::archive::{meta_value, Archive};
use super::property::{Properties, POD_F32, POD_I32, POD_U32};
use super::values::{f32s, i32s, u32s};
use crate::Result;

/// La portée d'un paramètre : ce que son rang désigne pour un coin de face donné.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Scope {
    Vertex,
    FaceVarying,
    Uniform,
    Constant,
}

impl Scope {
    fn read(meta: &str) -> Scope {
        match meta_value(meta, "geoScope") {
            Some("fvr") => Scope::FaceVarying,
            Some("uni") => Scope::Uniform,
            Some("con") => Scope::Constant,
            _ => Scope::Vertex,
        }
    }
}

/// Un paramètre de géométrie prêt à être lu coin par coin.
pub(super) struct GeomParam {
    values: Vec<f32>,
    width: usize,
    indices: Option<Vec<u32>>,
    scope: Scope,
}

impl GeomParam {
    /// Le rang de la valeur de ce coin : `corner` est son rang dans la table des indices de faces,
    /// `vertex` le sommet qu'il désigne, `face` la face à laquelle il appartient.
    pub(super) fn slot(&self, corner: usize, vertex: usize, face: usize) -> u32 {
        let raw = match self.scope {
            Scope::Vertex => vertex,
            Scope::FaceVarying => corner,
            Scope::Uniform => face,
            Scope::Constant => 0,
        };
        match &self.indices {
            Some(indices) => indices.get(raw).copied().unwrap_or_default(),
            None => u32::try_from(raw).unwrap_or_default(),
        }
    }

    /// La valeur à ce rang, ou `None` si le fichier la place hors de ce qu'il a écrit.
    pub(super) fn value(&self, slot: u32) -> Option<&[f32]> {
        let start = usize::try_from(slot).ok()?.checked_mul(self.width)?;
        self.values.get(start..start.checked_add(self.width)?)
    }

    /// Le paramètre couvre-t-il tous les coins de ce maillage ? Un paramètre qui déborde, faute
    /// d'échantillon complet ou d'indices cohérents, est écarté entier plutôt que complété.
    fn covers(&self, corners: &[i32], faces: usize) -> bool {
        let count = self.values.len() / self.width;
        let domain = match self.scope {
            Scope::Vertex => corners
                .iter()
                .copied()
                .max()
                .map_or(0, |highest| usize::try_from(highest).unwrap_or(0) + 1),
            Scope::FaceVarying => corners.len(),
            Scope::Uniform => faces,
            Scope::Constant => 1,
        };
        match &self.indices {
            Some(indices) => {
                indices.len() >= domain
                    && indices
                        .iter()
                        .all(|slot| usize::try_from(*slot).unwrap_or(usize::MAX) < count)
            }
            None => count >= domain,
        }
    }
}

/// La géométrie lue d'un maillage : une table de positions, une face par compte, et ses paramètres.
pub(super) struct Geometry {
    pub(super) positions: Vec<f32>,
    pub(super) counts: Vec<i32>,
    pub(super) corners: Vec<i32>,
    pub(super) normals: Option<GeomParam>,
    pub(super) uv: Option<GeomParam>,
    /// Ce que la lecture a écarté, à compter au rapport du pilote.
    pub(super) dropped: Vec<&'static str>,
}

impl Geometry {
    /// Lit la géométrie d'un `.geom`. Rend `None` quand la topologie n'y est pas : un maillage sans
    /// positions, sans faces ou sans indices n'est pas un maillage incomplet, c'est autre chose.
    pub(super) fn read(archive: &Archive, geom: &Properties) -> Result<Option<Geometry>> {
        let (Some(positions), Some(counts), Some(corners)) = (
            geom.sample(archive, "P", POD_F32, Some(3))?,
            geom.sample(archive, ".faceCounts", POD_I32, Some(1))?,
            geom.sample(archive, ".faceIndices", POD_I32, Some(1))?,
        ) else {
            return Ok(None);
        };
        let mut out = Geometry {
            positions: f32s(positions),
            counts: i32s(counts),
            corners: i32s(corners),
            normals: None,
            uv: None,
            dropped: Vec::new(),
        };
        out.normals = out.param(archive, geom, "N", 3, "alembic-normals-dropped")?;
        out.uv = out.param(archive, geom, "uv", 2, "alembic-uv-dropped")?;
        Ok(Some(out))
    }

    /// Un paramètre de géométrie nommé, sous l'une de ses deux formes, une fois vérifié qu'il couvre
    /// bien tous les coins. Sinon il est écarté sous le nom donné.
    fn param(
        &mut self,
        archive: &Archive,
        geom: &Properties,
        name: &str,
        width: usize,
        dropped: &'static str,
    ) -> Result<Option<GeomParam>> {
        let Some(found) = read_param(archive, geom, name, width)? else {
            return Ok(None);
        };
        if !found.covers(&self.corners, self.counts.len()) {
            self.dropped.push(dropped);
            return Ok(None);
        }
        Ok(Some(found))
    }
}

/// Le paramètre nommé, qu'il soit écrit en valeurs directes ou en valeurs indexées.
fn read_param(
    archive: &Archive,
    geom: &Properties,
    name: &str,
    width: usize,
) -> Result<Option<GeomParam>> {
    let Some(header) = geom.find(name) else {
        return Ok(None);
    };
    let scope = Scope::read(&header.meta);
    if let Some(compound) = geom.compound(archive, name)? {
        let Some(values) = compound.sample(archive, ".vals", POD_F32, Some(width as u8))? else {
            return Ok(None);
        };
        let indices = compound
            .sample(archive, ".indices", POD_U32, Some(1))?
            .map(u32s);
        return Ok(Some(GeomParam {
            values: f32s(values),
            width,
            indices,
            scope,
        }));
    }
    Ok(geom
        .sample(archive, name, POD_F32, Some(width as u8))?
        .map(|values| GeomParam {
            values: f32s(values),
            width,
            indices: None,
            scope,
        }))
}
