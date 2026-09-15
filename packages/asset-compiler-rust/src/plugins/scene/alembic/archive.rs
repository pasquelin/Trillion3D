//! La couche Alembic au-dessus des blocs Ogawa : métadonnées, objets, hiérarchie.
//!
//! Le groupe racine d'une archive porte six blocs — version, version de fichier, groupe des objets,
//! métadonnées de la racine, échantillonnages de temps, métadonnées indexées. Un **objet** est un
//! groupe dont le premier enfant tient ses propriétés, les suivants ses objets enfants, et le
//! dernier le bloc qui nomme ces enfants. Chaque nom s'accompagne d'une métadonnée, écrite en clair
//! ou désignée par son rang dans la table indexée ; c'est elle qui dit le schéma — `AbcGeom_Xform`,
//! `AbcGeom_PolyMesh`, `AbcGeom_FaceSet` — donc ce que l'objet est.
use super::ogawa::{invalid, is_data, Ogawa};
use crate::Result;
use std::path::Path;

/// Les trente-deux derniers octets d'un bloc d'en-têtes d'objets sont des empreintes, pas des noms.
const DIGEST_BYTES: usize = 32;
/// Un rang de métadonnée égal à cette valeur annonce une métadonnée écrite en clair à la suite.
pub(super) const META_INLINE: usize = 0xff;
/// Profondeur maximale d'une hiérarchie : au-delà, le fichier boucle ou ment sur sa structure.
pub(super) const MAX_DEPTH: usize = 64;

/// Une archive ouverte : le fichier, et ce que sa racine déclare une fois pour toutes.
pub(super) struct Archive {
    pub(super) file: Ogawa,
    /// Les métadonnées indexées, citées par rang dans tous les en-têtes du fichier.
    metas: Vec<String>,
}

/// Un objet de la hiérarchie : son nom, sa métadonnée — qui porte son schéma — et son groupe.
pub(super) struct Object {
    pub(super) name: String,
    pub(super) meta: String,
    pub(super) group: Vec<u64>,
}

/// Un curseur borné sur un bloc d'en-têtes : il rend `None` au lieu de sortir du bloc.
pub(super) struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    pub(super) fn new(bytes: &'a [u8]) -> Self {
        Cursor { bytes, at: 0 }
    }
    pub(super) fn done(&self) -> bool {
        self.at >= self.bytes.len()
    }
    pub(super) fn u8(&mut self) -> Option<u8> {
        let value = *self.bytes.get(self.at)?;
        self.at += 1;
        Some(value)
    }
    pub(super) fn u16(&mut self) -> Option<u32> {
        let slice = self.bytes.get(self.at..self.at + 2)?;
        self.at += 2;
        Some(u32::from(u16::from_le_bytes(slice.try_into().ok()?)))
    }
    pub(super) fn u32(&mut self) -> Option<u32> {
        let slice = self.bytes.get(self.at..self.at + 4)?;
        self.at += 4;
        Some(u32::from_le_bytes(slice.try_into().ok()?))
    }
    /// Les `length` octets suivants, lus comme du texte. Un octet illisible devient le caractère de
    /// remplacement : un nom mal encodé ne fait pas échouer une scène entière.
    pub(super) fn text(&mut self, length: u32) -> Option<String> {
        let length = usize::try_from(length).ok()?;
        let slice = self.bytes.get(self.at..self.at.checked_add(length)?)?;
        self.at += length;
        Some(String::from_utf8_lossy(slice).into_owned())
    }
}

impl Archive {
    /// Ouvre l'archive et lit sa table de métadonnées.
    pub(super) fn open(path: &Path) -> Result<Archive> {
        let file = Ogawa::open(path)?;
        if file.root.len() < 6 {
            return Err(invalid(format!(
                "{}: the Ogawa root group carries {} blocks, an Alembic archive carries six",
                path.display(),
                file.root.len()
            )));
        }
        let metas = indexed_metas(file.data(file.root[5])?);
        Ok(Archive { file, metas })
    }

    /// La métadonnée que ce rang désigne dans la table indexée.
    pub(super) fn meta(&self, index: usize) -> String {
        self.metas.get(index).cloned().unwrap_or_default()
    }

    /// L'objet racine : le sommet de la hiérarchie, sans nom et sans schéma.
    pub(super) fn root_object(&self) -> Result<Object> {
        Ok(Object {
            name: String::new(),
            meta: String::from_utf8_lossy(self.file.data(self.file.root[3])?).into_owned(),
            group: self.file.group(self.file.root[2])?,
        })
    }

    /// Les objets enfants de celui-ci, dans l'ordre où le fichier les déclare.
    pub(super) fn children(&self, object: &Object) -> Result<Vec<Object>> {
        let Some(last) = object.group.last().copied() else {
            return Ok(Vec::new());
        };
        if !is_data(last) {
            return Ok(Vec::new());
        }
        let block = self.file.data(last)?;
        let names = self.object_headers(block)?;
        names
            .into_iter()
            .enumerate()
            .map(|(rank, (name, meta))| {
                let child = object
                    .group
                    .get(rank + 1)
                    .copied()
                    .ok_or_else(|| invalid(format!("object {name:?} has no group")))?;
                Ok(Object {
                    name,
                    meta,
                    group: self.file.group(child)?,
                })
            })
            .collect()
    }

    /// Les noms et métadonnées d'un bloc d'en-têtes d'objets, dont les empreintes finales sont
    /// laissées de côté : ce pilote lit une scène, il ne rejoue pas les condensés de l'écrivain.
    fn object_headers(&self, block: &[u8]) -> Result<Vec<(String, String)>> {
        let Some(body) = block
            .len()
            .checked_sub(DIGEST_BYTES)
            .map(|end| &block[..end])
        else {
            return Ok(Vec::new());
        };
        let mut cursor = Cursor::new(body);
        let mut out = Vec::new();
        while !cursor.done() {
            let header = (|| {
                let size = cursor.u32()?;
                let name = cursor.text(size)?;
                let rank = usize::from(cursor.u8()?);
                let meta = if rank == META_INLINE {
                    let size = cursor.u32()?;
                    cursor.text(size)?
                } else {
                    self.meta(rank)
                };
                Some((name, meta))
            })();
            out.push(header.ok_or_else(|| invalid("an object header block is truncated"))?);
        }
        Ok(out)
    }
}

/// La table des métadonnées indexées : une longueur d'un octet, puis son texte. Le rang zéro est la
/// métadonnée vide, que le format ne écrit pas.
fn indexed_metas(block: &[u8]) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut cursor = Cursor::new(block);
    while !cursor.done() {
        let Some(size) = cursor.u8() else { break };
        let Some(text) = cursor.text(u32::from(size)) else {
            break;
        };
        out.push(text);
    }
    out
}

/// La valeur d'une clé d'une métadonnée Alembic, écrite en `clé=valeur;clé=valeur`.
pub(super) fn meta_value<'a>(meta: &'a str, key: &str) -> Option<&'a str> {
    meta.split(';').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        (name == key).then_some(value)
    })
}
