//! Le découpage d'un fichier Blender en blocs, et leur index par adresse.
//!
//! Disposition publique du format : après l'entête vient une suite de blocs, jusqu'à `ENDB`. Chaque
//! bloc porte un code de quatre octets, l'index de la structure SDNA qui décrit ses octets,
//! l'adresse qu'il occupait en mémoire quand le fichier a été écrit — c'est elle qui sert de clé à
//! tous les pointeurs du fichier —, la taille de ses données et le nombre de structures qu'elles
//! portent. L'ancienne disposition écrit ces champs sur trente-deux bits, la récente sur
//! soixante-quatre ; l'entête dit laquelle.
//!
//! Aucune taille annoncée n'est crue sans être bornée par le fichier : tout dépassement est un
//! fichier tronqué, nommé comme tel.
use super::*;

/// La longueur de l'entête d'un bloc à champs de soixante-quatre bits.
const WIDE_HEADER: usize = 32;

/// Un bloc du fichier : son code, la structure qui le décrit, et où ses octets vivent.
pub(super) struct Block {
    pub(super) code: [u8; 4],
    pub(super) sdna: usize,
    pub(super) old: u64,
    pub(super) start: usize,
    pub(super) len: usize,
    /// Le nombre de structures que ses octets portent : la borne d'un tableau de structures.
    pub(super) count: usize,
}

/// Un fichier Blender ouvert : ses octets déballés, son SDNA, ses blocs et leur index par adresse.
pub(super) struct BlendFile {
    pub(super) bytes: Vec<u8>,
    pub(super) version: u32,
    pub(super) blocks: Vec<Block>,
    pub(super) dna: Dna,
    index: HashMap<u64, usize>,
}

impl BlendFile {
    /// Ouvre un fichier Blender : défait l'enveloppe sous `ceiling`, lit l'entête, parcourt les
    /// blocs, puis le bloc `DNA1` qui décrit toutes les structures.
    pub(super) fn open(raw: &[u8], ceiling: usize) -> Result<BlendFile> {
        let bytes = envelope::unwrap(raw, ceiling)?;
        let shape = envelope::head(&bytes)?;
        let blocks = walk(&bytes, &shape)?;
        let dna = blocks
            .iter()
            .find(|block| &block.code == b"DNA1")
            .ok_or_else(|| refused("blend-dna-invalid", "blend: no DNA1 block in this file"))
            .and_then(|block| Dna::read(&bytes[block.start..block.start + block.len]))?;
        let index = blocks
            .iter()
            .enumerate()
            .filter(|(_, block)| block.old != 0)
            .map(|(rank, block)| (block.old, rank))
            .collect();
        Ok(BlendFile {
            bytes,
            version: shape.version,
            blocks,
            dna,
            index,
        })
    }
    /// Le bloc que cette adresse d'origine désigne. Un pointeur nul, ou vers un bloc absent, n'en
    /// désigne aucun : c'est le lecteur qui décide quoi en dire, jamais une panique.
    pub(super) fn at(&self, old: u64) -> Option<&Block> {
        self.index.get(&old).map(|rank| &self.blocks[*rank])
    }
    /// Les blocs d'un code donné, dans l'ordre du fichier.
    pub(super) fn of(&self, code: [u8; 4]) -> impl Iterator<Item = &Block> {
        self.blocks.iter().filter(move |block| block.code == code)
    }
}

/// Parcourt les blocs depuis la fin de l'entête jusqu'à `ENDB`.
fn walk(bytes: &[u8], shape: &envelope::Shape) -> Result<Vec<Block>> {
    let truncated = || refused("blend-truncated", "blend: the file ends inside a block");
    let header = if shape.wide {
        WIDE_HEADER
    } else {
        16 + shape.pointer
    };
    let mut blocks = Vec::new();
    let mut at = shape.header;
    loop {
        let fields = bytes.get(at..at + header).ok_or_else(truncated)?;
        let code: [u8; 4] = fields[..4].try_into().map_err(|_| truncated())?;
        let word = |from: usize| u32::from_le_bytes(fields[from..from + 4].try_into().unwrap());
        let wide = |from: usize| u64::from_le_bytes(fields[from..from + 8].try_into().unwrap());
        let (sdna, old, len, count) = if shape.wide {
            (word(4), wide(8), wide(16), wide(24))
        } else {
            (word(16), wide(8), u64::from(word(4)), u64::from(word(20)))
        };
        let start = at + header;
        let len = usize::try_from(len).map_err(|_| truncated())?;
        match start.checked_add(len) {
            Some(end) if end <= bytes.len() => {}
            _ => return Err(truncated()),
        }
        let done = &code == b"ENDB";
        blocks.push(Block {
            code,
            sdna: sdna as usize,
            old,
            start,
            len,
            count: count as usize,
        });
        if done {
            return Ok(blocks);
        }
        at = start + len;
    }
}
