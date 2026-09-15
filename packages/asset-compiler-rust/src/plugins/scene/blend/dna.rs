//! Le SDNA : la description que chaque fichier Blender porte de ses propres structures.
//!
//! Le bloc `DNA1` est l'auto-description publique du format. Il enchaîne quatre sections repérées
//! par une étiquette de quatre octets et alignées sur quatre : `NAME` les noms de champs,
//! `TYPE` les noms de types, `TLEN` la taille de chaque type, `STRC` les structures — pour chacune,
//! son type puis ses champs, donnés par un index de type et un index de nom.
//!
//! C'est de là que ce pilote tire tous ses décalages : **aucun décalage n'est écrit en dur**. Un
//! champ se demande par son nom, et une structure qui perd, gagne ou déplace un champ d'une version
//! de Blender à l'autre reste lisible tant que les noms utilisés ici existent.
use super::*;

/// La taille d'un pointeur, celle des seuls fichiers que ce lecteur ouvre.
pub(super) const POINTER: usize = 8;

/// Un champ d'une structure : où il commence, ce qu'il porte, combien de fois.
pub(super) struct Field {
    pub(super) offset: usize,
    pub(super) kind: String,
    pub(super) unit: usize,
    pub(super) count: usize,
    pub(super) pointer: bool,
}

/// Une structure du fichier : son nom de type, sa taille et ses champs par nom.
pub(super) struct Layout {
    pub(super) name: String,
    pub(super) size: usize,
    pub(super) fields: HashMap<String, Field>,
}

/// Toutes les structures décrites par le fichier, et de quoi les retrouver par leur nom.
pub(super) struct Dna {
    pub(super) structs: Vec<Layout>,
    by_name: HashMap<String, usize>,
}

impl Dna {
    pub(super) fn read(bytes: &[u8]) -> Result<Dna> {
        let mut at = 0;
        tag(bytes, &mut at, b"SDNA")?;
        let names = strings(bytes, &mut at, b"NAME")?;
        let types = strings(bytes, &mut at, b"TYPE")?;
        tag(bytes, &mut at, b"TLEN")?;
        let mut lengths = Vec::with_capacity(types.len());
        for _ in 0..types.len() {
            lengths.push(u16::from_le_bytes(word(bytes, &mut at)?) as usize);
        }
        at = (at + 3) & !3;
        tag(bytes, &mut at, b"STRC")?;
        let total = u32::from_le_bytes(word(bytes, &mut at)?) as usize;
        let mut structs = Vec::with_capacity(total);
        for _ in 0..total {
            structs.push(layout(bytes, &mut at, &names, &types, &lengths)?);
        }
        let by_name = structs
            .iter()
            .enumerate()
            .map(|(rank, entry)| (entry.name.clone(), rank))
            .collect();
        Ok(Dna { structs, by_name })
    }
    /// Le rang d'une structure nommée, quand ce fichier la décrit.
    pub(super) fn index(&self, name: &str) -> Option<usize> {
        self.by_name.get(name).copied()
    }
    pub(super) fn layout(&self, kind: usize) -> Option<&Layout> {
        self.structs.get(kind)
    }
}

impl Layout {
    pub(super) fn field(&self, name: &str) -> Option<&Field> {
        self.fields.get(name)
    }
}

fn invalid() -> CompilerError {
    refused(
        "blend-dna-invalid",
        "blend: the DNA1 block does not read back",
    )
}

/// Une étiquette de section, lue là où elle doit être.
fn tag(bytes: &[u8], at: &mut usize, expected: &[u8; 4]) -> Result<()> {
    let found = bytes.get(*at..*at + 4).ok_or_else(invalid)?;
    if found != expected {
        return Err(invalid());
    }
    *at += 4;
    Ok(())
}

fn word<const N: usize>(bytes: &[u8], at: &mut usize) -> Result<[u8; N]> {
    let found: [u8; N] = bytes
        .get(*at..*at + N)
        .ok_or_else(invalid)?
        .try_into()
        .map_err(|_| invalid())?;
    *at += N;
    Ok(found)
}

/// Une section de chaînes : son étiquette, son compte, puis les chaînes, le tout aligné sur quatre.
fn strings(bytes: &[u8], at: &mut usize, label: &[u8; 4]) -> Result<Vec<String>> {
    tag(bytes, at, label)?;
    let total = u32::from_le_bytes(word(bytes, at)?) as usize;
    let mut out = Vec::with_capacity(total.min(1 << 16));
    for _ in 0..total {
        let rest = bytes.get(*at..).ok_or_else(invalid)?;
        let end = rest
            .iter()
            .position(|byte| *byte == 0)
            .ok_or_else(invalid)?;
        out.push(String::from_utf8_lossy(&rest[..end]).into_owned());
        *at += end + 1;
    }
    *at = (*at + 3) & !3;
    Ok(out)
}

/// Une structure et ses champs : les décalages se cumulent dans l'ordre déclaré, un pointeur pesant
/// toujours la taille de pointeur du fichier, un tableau le produit de ses dimensions.
fn layout(
    bytes: &[u8],
    at: &mut usize,
    names: &[String],
    types: &[String],
    lengths: &[usize],
) -> Result<Layout> {
    let kind = u16::from_le_bytes(word(bytes, at)?) as usize;
    let total = u16::from_le_bytes(word(bytes, at)?) as usize;
    let mut fields = HashMap::with_capacity(total);
    let mut offset = 0;
    for _ in 0..total {
        let kind = u16::from_le_bytes(word(bytes, at)?) as usize;
        let name = u16::from_le_bytes(word(bytes, at)?) as usize;
        let name = names.get(name).ok_or_else(invalid)?;
        let pointer = name.contains('*');
        let unit = if pointer {
            POINTER
        } else {
            *lengths.get(kind).ok_or_else(invalid)?
        };
        let count = elements(name);
        fields.insert(
            key(name).to_string(),
            Field {
                offset,
                kind: types.get(kind).ok_or_else(invalid)?.clone(),
                unit,
                count,
                pointer,
            },
        );
        offset += unit * count;
    }
    // La taille déclarée par `TLEN` fait foi — c'est celle du pas d'un tableau de structures ; la
    // somme des champs ne sert que si le fichier n'en déclare pas.
    let declared = lengths.get(kind).copied().unwrap_or(0);
    Ok(Layout {
        name: types.get(kind).ok_or_else(invalid)?.clone(),
        size: if declared > 0 { declared } else { offset },
        fields,
    })
}

/// Le nom nu d'un champ, sans les étoiles, les crochets ni les parenthèses d'un pointeur de
/// fonction : c'est par ce nom que le lecteur demande un champ.
fn key(name: &str) -> &str {
    let start = name
        .find(|c: char| c.is_alphanumeric() || c == '_')
        .unwrap_or(name.len());
    let rest = &name[start..];
    let end = rest
        .find(|c: char| !(c.is_alphanumeric() || c == '_'))
        .unwrap_or(rest.len());
    &rest[..end]
}

/// Le nombre d'éléments qu'un nom de champ déclare : le produit de ses dimensions, une pour un
/// champ simple.
fn elements(name: &str) -> usize {
    let mut total = 1;
    let mut rest = name;
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find(']') else {
            break;
        };
        total *= rest[open + 1..open + close].parse::<usize>().unwrap_or(1);
        rest = &rest[open + close + 1..];
    }
    total
}
