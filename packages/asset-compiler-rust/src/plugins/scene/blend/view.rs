//! Lire un champ par son nom, dans les octets d'un bloc.
//!
//! Une vue, c'est une structure du SDNA posée sur un décalage du fichier. Tout passe par là :
//! nombres, pointeurs, chaînes en place, structures imbriquées et structures pointées. Un champ
//! absent de cette version du format ne fait jamais paniquer — il rend la valeur par défaut que
//! l'appelant a donnée, et c'est à l'appelant de dire ce qu'il en fait.
//!
//! Une vue est bornée **au bloc** qu'elle lit, jamais au fichier : un bloc plus court que la
//! structure que son entête nomme rendrait sinon les octets du bloc suivant comme s'ils étaient les
//! siens. Un champ qui déborde du bloc est donc traité comme un champ absent.
use super::*;

/// Une structure lue à un décalage du fichier.
#[derive(Clone, Copy)]
pub(super) struct At<'a> {
    pub(super) file: &'a BlendFile,
    pub(super) layout: &'a Layout,
    pub(super) base: usize,
    /// La fin des octets du bloc atteint : aucun champ ne se lit au-delà.
    limit: usize,
    /// L'adresse d'origine du bloc atteint : c'est par elle que les pointeurs du fichier se
    /// comparent entre eux. Zéro pour une structure imbriquée, qui n'en a pas.
    pub(super) old: u64,
}

impl BlendFile {
    /// La vue d'un bloc, typée par la structure que son entête nomme.
    pub(super) fn view<'a>(&'a self, block: &Block) -> Option<At<'a>> {
        Some(At {
            file: self,
            layout: self.dna.layout(block.sdna)?,
            base: block.start,
            limit: block.start.saturating_add(block.len),
            old: block.old,
        })
    }
    /// La vue d'un bloc, forcée à une structure nommée : c'est ainsi qu'on lit ce qu'un `void *`
    /// désigne, le bloc pointé ne portant alors pas le type utile dans son entête.
    pub(super) fn view_as<'a>(&'a self, block: &Block, kind: &str) -> Option<At<'a>> {
        Some(At {
            file: self,
            layout: self.dna.layout(self.dna.index(kind)?)?,
            base: block.start,
            limit: block.start.saturating_add(block.len),
            old: block.old,
        })
    }
    /// Les octets d'un bloc désigné par une adresse d'origine.
    pub(super) fn bytes_at(&self, pointer: u64) -> Option<&[u8]> {
        let block = self.at(pointer)?;
        self.bytes.get(block.start..block.start + block.len)
    }
    /// La chaîne que porte un bloc désigné par un `char *`, sans son zéro terminal.
    pub(super) fn text_at(&self, pointer: u64) -> Option<String> {
        let bytes = self.bytes_at(pointer)?;
        let end = bytes
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(bytes.len());
        Some(String::from_utf8_lossy(&bytes[..end]).into_owned())
    }
}

impl<'a> At<'a> {
    pub(super) fn has(&self, name: &str) -> bool {
        self.layout.field(name).is_some()
    }
    /// Les octets d'un champ, bornés par le bloc. Un champ dont la fin déborde du bloc — ou dont le
    /// produit taille par compte déborde — est traité comme absent.
    fn raw(&self, name: &str) -> Option<(&'a Field, &'a [u8])> {
        let field = self.layout.field(name)?;
        let from = self.base.checked_add(field.offset)?;
        let end = field
            .unit
            .checked_mul(field.count)
            .and_then(|span| from.checked_add(span))
            .filter(|end| *end <= self.limit)?;
        let bytes = self.file.bytes.get(from..end)?;
        Some((field, bytes))
    }
    /// Un entier, quelle que soit sa largeur et sa signature déclarées.
    pub(super) fn int(&self, name: &str, default: i64) -> i64 {
        let Some((field, bytes)) = self.raw(name) else {
            return default;
        };
        bytes::scalar(field, bytes).unwrap_or(default)
    }
    pub(super) fn float(&self, name: &str, default: f32) -> f32 {
        self.floats(name).first().copied().unwrap_or(default)
    }
    /// Tous les flottants d'un champ, un pour un champ simple, davantage pour un tableau.
    pub(super) fn floats(&self, name: &str) -> Vec<f32> {
        let Some((field, bytes)) = self.raw(name) else {
            return Vec::new();
        };
        if field.pointer || field.unit != 4 || field.kind != "float" {
            return Vec::new();
        }
        bytes::floats(bytes, field.count)
    }
    /// L'adresse d'origine que porte un champ pointeur. Zéro quand il n'en porte pas.
    pub(super) fn pointer(&self, name: &str) -> u64 {
        let Some((field, bytes)) = self.raw(name) else {
            return 0;
        };
        if !field.pointer || bytes.len() < POINTER {
            return 0;
        }
        u64::from_le_bytes(bytes[..POINTER].try_into().unwrap_or_default())
    }
    /// Une chaîne écrite en place dans un tableau de caractères, sans son zéro terminal.
    pub(super) fn text(&self, name: &str) -> String {
        let Some((field, bytes)) = self.raw(name) else {
            return String::new();
        };
        if field.pointer {
            return self.file.text_at(self.pointer(name)).unwrap_or_default();
        }
        let end = bytes
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(bytes.len());
        String::from_utf8_lossy(&bytes[..end]).into_owned()
    }
    /// Une structure imbriquée, typée par le type que le SDNA donne au champ.
    pub(super) fn inner(&self, name: &str) -> Option<At<'a>> {
        let field = self.layout.field(name)?;
        let kind = self.file.dna.index(&field.kind)?;
        Some(At {
            file: self.file,
            layout: self.file.dna.layout(kind)?,
            base: self.base.checked_add(field.offset)?,
            limit: self.limit,
            old: 0,
        })
    }
    /// La structure qu'un champ pointeur désigne, typée par l'entête du bloc atteint.
    pub(super) fn follow(&self, name: &str) -> Option<At<'a>> {
        let block = self.file.at(self.pointer(name))?;
        self.file.view(block)
    }
    /// La structure qu'un champ pointeur désigne, forcée à un type nommé — le cas d'un `void *`.
    pub(super) fn follow_as(&self, name: &str, kind: &str) -> Option<At<'a>> {
        let block = self.file.at(self.pointer(name))?;
        self.file.view_as(block, kind)
    }
    /// Les octets du bloc qu'un champ pointeur désigne.
    pub(super) fn block(&self, name: &str) -> Option<&'a [u8]> {
        self.file.bytes_at(self.pointer(name))
    }
    /// La vue d'un élément d'un tableau de structures : le bloc pointé porte `count` structures
    /// d'affilée, et c'est la taille déclarée par le SDNA qui donne le pas.
    pub(super) fn item(&self, rank: usize) -> Option<At<'a>> {
        Some(At {
            file: self.file,
            layout: self.layout,
            base: self.base.checked_add(rank.checked_mul(self.layout.size)?)?,
            limit: self.limit,
            old: self.old,
        })
    }
    /// Le nom d'un bloc de données identifié : Blender le range dans sa sous-structure `id`, avec
    /// deux lettres de préfixe qui disent son genre.
    pub(super) fn id_name(&self) -> String {
        self.inner("id")
            .map(|id| id.text("name"))
            .unwrap_or_default()
    }
    /// Les maillons d'une `ListBase` : la liste chaînée que Blender écrit bloc par bloc, chaque
    /// maillon commençant par son `next`. Bornée pour qu'un fichier abîmé ne tourne pas en rond.
    pub(super) fn list(&self, name: &str) -> Vec<At<'a>> {
        let mut out = Vec::new();
        let Some(head) = self.inner(name) else {
            return out;
        };
        let mut pointer = head.pointer("first");
        while let Some(block) = self.file.at(pointer) {
            let Some(item) = self.file.view(block) else {
                break;
            };
            pointer = item.pointer("next");
            out.push(item);
            if out.len() >= MAX_LIST {
                break;
            }
        }
        out
    }
}
