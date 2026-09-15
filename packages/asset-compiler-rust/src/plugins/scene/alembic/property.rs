//! Les propriétés d'un objet Alembic : leurs en-têtes, et le premier échantillon de chacune.
//!
//! Un groupe de propriétés porte une sous-propriété par enfant et, en dernier enfant, le bloc qui
//! les décrit toutes. Chaque description tient dans un entier de trente-deux bits — sorte, type de
//! donnée, largeur, nombre d'échantillons, rang de métadonnée — suivi des champs de longueur
//! variable que ces bits annoncent, chacun écrit sur un, deux ou quatre octets selon le même entier.
//!
//! Une propriété **composée** contient d'autres propriétés ; une **scalaire** et un **tableau**
//! portent des échantillons, un par enfant pour la première, deux — valeurs puis dimensions — pour
//! le second. Chaque échantillon s'ouvre sur seize octets de clé que l'écrivain y a laissés.
use super::archive::{Archive, Cursor, META_INLINE};
use super::ogawa::{invalid, is_data};
use crate::Result;

/// Les seize octets de clé qui précèdent les valeurs de tout échantillon.
const SAMPLE_KEY_BYTES: usize = 16;
/// Les types de donnée que ce pilote lit. Les autres sont laissés à leur rang, sans être décodés.
pub(super) const POD_BOOL: u32 = 0;
pub(super) const POD_U8: u32 = 1;
pub(super) const POD_U32: u32 = 5;
pub(super) const POD_I32: u32 = 6;
pub(super) const POD_F32: u32 = 10;
pub(super) const POD_F64: u32 = 11;

/// La sorte d'une propriété.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    Compound,
    Scalar,
    Array,
}

/// Une propriété déclarée : ce que son en-tête dit, et le pointeur vers ses échantillons.
pub(super) struct Property {
    pub(super) name: String,
    pub(super) kind: Kind,
    /// Le type de donnée d'un échantillon, et le nombre de composantes par élément.
    pub(super) pod: u32,
    pub(super) extent: u8,
    /// Le nombre d'échantillons : au-delà de un, la propriété est animée.
    pub(super) samples: u32,
    pub(super) meta: String,
    child: u64,
}

/// Les propriétés d'un groupe, dans l'ordre déclaré.
pub(super) struct Properties {
    entries: Vec<Property>,
}

impl Properties {
    /// Lit les propriétés que porte le groupe désigné par ce pointeur.
    pub(super) fn read(archive: &Archive, child: u64) -> Result<Properties> {
        let group = archive.file.group(child)?;
        let Some(last) = group.last().copied().filter(|last| is_data(*last)) else {
            return Ok(Properties {
                entries: Vec::new(),
            });
        };
        let block = archive.file.data(last)?;
        let mut cursor = Cursor::new(block);
        let mut entries = Vec::new();
        while !cursor.done() {
            let header = read_header(archive, &mut cursor)
                .ok_or_else(|| invalid("a property header block is truncated"))?;
            let child = group
                .get(entries.len())
                .copied()
                .ok_or_else(|| invalid("a property header has no group"))?;
            entries.push(Property { child, ..header });
        }
        Ok(Properties { entries })
    }

    pub(super) fn find(&self, name: &str) -> Option<&Property> {
        self.entries.iter().find(|entry| entry.name == name)
    }

    /// Les propriétés d'une sous-propriété composée.
    pub(super) fn compound(&self, archive: &Archive, name: &str) -> Result<Option<Properties>> {
        match self.find(name).filter(|found| found.kind == Kind::Compound) {
            Some(found) => Properties::read(archive, found.child).map(Some),
            None => Ok(None),
        }
    }

    /// Le premier échantillon d'une propriété nommée, clé retirée. Une propriété absente, vide ou
    /// d'un autre type rend `None` : c'est à l'appelant d'en faire une absence ou un refus. Une
    /// largeur donnée est exigée ; `None` accepte celle que le fichier déclare, pour les propriétés
    /// dont la largeur est le compte — la pile d'opérations d'un `Xform` et ses valeurs.
    pub(super) fn sample<'a>(
        &self,
        archive: &'a Archive,
        name: &str,
        pod: u32,
        extent: Option<u8>,
    ) -> Result<Option<&'a [u8]>> {
        let wanted = |found: &&Property| {
            found.pod == pod && extent.is_none_or(|extent| found.extent == extent)
        };
        match self.find(name).filter(wanted) {
            Some(found) => first_sample(archive, found),
            None => Ok(None),
        }
    }
}

/// Le premier échantillon d'une propriété, clé retirée.
pub(super) fn first_sample<'a>(
    archive: &'a Archive,
    property: &Property,
) -> Result<Option<&'a [u8]>> {
    if property.samples == 0 || property.kind == Kind::Compound {
        return Ok(None);
    }
    let group = archive.file.group(property.child)?;
    let Some(first) = group.first().copied().filter(|first| is_data(*first)) else {
        return Ok(None);
    };
    Ok(archive.file.data(first)?.get(SAMPLE_KEY_BYTES..))
}

/// Un en-tête de propriété, sans le pointeur de son groupe, que l'appelant rattache ensuite.
fn read_header(archive: &Archive, cursor: &mut Cursor<'_>) -> Option<Property> {
    let info = cursor.u32()?;
    let kind = match info & 0x3 {
        0 => Kind::Compound,
        1 => Kind::Scalar,
        _ => Kind::Array,
    };
    let hint = (info >> 2) & 0x3;
    let mut pod = 0;
    let mut extent = 0;
    let mut samples = 0;
    if kind != Kind::Compound {
        pod = (info >> 4) & 0xf;
        extent = ((info >> 12) & 0xff) as u8;
        samples = sized(cursor, hint)?;
        // Les rangs du premier et du dernier échantillon changés ne servent qu'à retrouver un
        // échantillon au milieu d'une animation ; ce pilote ne lit que le premier, mais leurs
        // octets sont dans le flux et doivent être consommés pour atteindre le nom.
        if info & 0x0200 != 0 {
            sized(cursor, hint)?;
            sized(cursor, hint)?;
        }
        if info & 0x0100 != 0 {
            sized(cursor, hint)?;
        }
    }
    let size = sized(cursor, hint)?;
    let name = cursor.text(size)?;
    let rank = ((info >> 20) & 0xff) as usize;
    let meta = if rank == META_INLINE {
        let size = sized(cursor, hint)?;
        cursor.text(size)?
    } else {
        archive.meta(rank)
    };
    Some(Property {
        name,
        kind,
        pod,
        extent,
        samples,
        meta,
        child: 0,
    })
}

/// Un entier dont la largeur — un, deux ou quatre octets — est annoncée par l'en-tête.
fn sized(cursor: &mut Cursor<'_>, hint: u32) -> Option<u32> {
    match hint {
        0 => cursor.u8().map(u32::from),
        1 => cursor.u16(),
        2 => cursor.u32(),
        _ => None,
    }
}
