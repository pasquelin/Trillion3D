//! La chaîne de mips de chaque texture d'atlas, cuite une fois pour toutes.
//!
//! Le moteur écrivait la queue de la chaîne — du niveau dont aucun côté ne dépasse `PREVIEW_BASE`
//! jusqu'au 1×1 — depuis le sidecar, puis attendait la pleine résolution et régénérait TOUT le
//! reste sur la carte graphique. Entre 64 px et la source il n'existait donc aucun niveau : une
//! texture qui voulait un 256 px devait charger et décoder son 2048², et la résidence ne pouvait
//! pas suivre ce que l'écran demande. Ici, chaque niveau existe : la queue reste dans le sidecar,
//! en RGBA8 ; les niveaux au-dessus sont des PNG sans perte dans le cache, un fichier par niveau,
//! adressés par l'empreinte des octets sources et par atlas (`textures/<sha>/<srgb|linear>-<k>.png`),
//! donc partagés par toute scène qui partage l'image, et jamais réécrits s'ils existent déjà.
//!
//! La règle de réduction est celle que la carte appliquait (`reduce.rs`) : cuire au lieu de
//! régénérer ne change pas l'image. Les deux atlas du moteur sont couverts — couleur de base et
//! émissif dans l'un, métal-rugosité, normale et occlusion dans l'autre —, chacun par sa courbe.
//!
//! Un décodage impossible — un format hors du registre des pilotes d'image, un PNG corrompu, une
//! image absente — est une entrée de rapport nommée et aucun niveau : la compilation n'échoue
//! jamais pour une texture, et le moteur retombe sur son blanc.
use super::*;
use std::sync::atomic::AtomicUsize;

pub(crate) mod bake;
pub(crate) mod collect;
mod curves;
mod levels;
mod reduce;
pub(crate) mod source;
#[cfg(test)]
mod tests;
pub use levels::*;

/// Contrat de la section : bouger l'échelle des niveaux, leur ordre, la règle de réduction ou
/// l'espace colorimétrique impose d'incrémenter ce numéro et celui du sidecar binaire qui la
/// transporte. La 3 est la règle de la carte graphique et la chaîne entière, deux atlas compris.
pub const TEXTURE_PREVIEW_VERSION: u32 = 3;
pub use bake::{texture_version_dir, TEXTURE_DIR};
pub use reduce::AtlasKind;
/// Le gabarit d'un niveau cuit, relativement à `native/` ; `bake::level_path` le remplit.
pub fn level_template() -> String {
    format!(
        "{}/{{sha}}/{{kind}}-{{level}}.png",
        bake::texture_version_dir()
    )
}
/// Plus grand côté qu'un niveau porté par le sidecar peut avoir. Le choix borne la section : au plus
/// 21 844 octets par texture, contre les mégaoctets qu'un niveau 256 ou 512 y ajouterait.
pub const PREVIEW_BASE: u32 = 64;
/// Niveaux qu'une entrée porte au plus : 64, 32, 16, 8, 4, 2, 1.
pub const PREVIEW_MAX_LEVELS: u32 = 7;
/// Plafond d'allocation d'un décodage. Une image plus grande est une entrée de rapport, pas un échec.
const PREVIEW_MAX_ALLOC: u64 = 512 * 1024 * 1024;

/// D'où viennent les octets sources d'un aperçu. L'`uri` elle-même n'est pas recopiée : elle se lit
/// dans `source.gltf` à `images[image]`, que cette entrée nomme.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PreviewSource {
    Uri,
    BufferView(u32),
}
impl PreviewSource {
    pub fn kind(self) -> u32 {
        match self {
            Self::Uri => 0,
            Self::BufferView(_) => 1,
        }
    }
    pub fn buffer_view(self) -> u32 {
        match self {
            Self::Uri => u32::MAX,
            Self::BufferView(view) => view,
        }
    }
}

/// Une entrée de la section : la texture qu'elle couvre, sa provenance et les octets de ses niveaux.
/// `first_level` et le nombre de niveaux se redéduisent de `width` et `height` ; les porter dans
/// l'entrée laisse un lecteur refuser une entrée qui ne s'accorde pas avec ses propres dimensions.
pub struct TexturePreview {
    pub texture: u32,
    pub image: u32,
    pub width: u32,
    pub height: u32,
    pub source: PreviewSource,
    pub sha256: String,
    /// L'atlas que cette entrée sert : la même texture peut en avoir une par atlas.
    pub kind: AtlasKind,
    pub first_level: u32,
    /// Niveaux écrits dans le cache comme fichiers PNG, du 0 au `baked_levels - 1` : `first_level`
    /// quand la chaîne est entière, 0 quand rien n'a pu être écrit.
    pub baked_levels: u32,
    pub pixels: Vec<u8>,
}

/// Tout ce que l'étape lit. `view_map` traduit les vues du glTF d'entrée vers celles écrites dans
/// `source.gltf`, pour que la provenance nomme l'index que le moteur voit.
pub(super) struct PreviewInputs<'a> {
    pub o: &'a Options,
    pub g: &'a Value,
    pub bin: &'a [u8],
    /// La racine de résolution des images de la scène intermédiaire, que `plugins::scene` nomme :
    /// le dossier source, ou le dossier extrait d'un conteneur — jamais celui du cache.
    pub image_root: &'a Path,
    pub meshes: &'a BTreeSet<usize>,
    pub view_map: &'a BTreeMap<usize, usize>,
    /// Les textures dont l'alpha est à mesurer au passage, que `cutout` a désignées : cette étape
    /// sait ce qu'elle décode, pas ce qu'est une découpe.
    pub to_measure: &'a BTreeSet<usize>,
}

/// Calcule la chaîne de chaque texture d'atlas des maillages retenus, une image décodée une seule
/// fois quelles que soient les textures qui la citent. Rend les entrées triées par texture puis par
/// atlas, la forme de l'alpha des textures candidates à la découpe — mesurée dans ce décodage,
/// jamais dans un second — et le rapport de l'étape. Les images se traitent en parallèle sur la
/// grappe de l'appelant, chacune dans la limite d'allocation d'un décodage.
pub(super) fn stage_texture_previews(
    inputs: &PreviewInputs<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(
    Vec<TexturePreview>,
    BTreeMap<usize, crate::cutout::AlphaShape>,
    Value,
)> {
    let wanted = collect::atlas_textures(inputs.g, inputs.meshes)?;
    let (Some(textures), Some(images)) = (
        inputs.g.get("textures").and_then(Value::as_array),
        inputs.g.get("images").and_then(Value::as_array),
    ) else {
        let report = bake::report(&wanted, &[], &BTreeMap::new(), &BTreeMap::new());
        return Ok((Vec::new(), BTreeMap::new(), report));
    };
    // Par image : les (texture, atlas) qui la lisent. Une texture sans image est une entrée de
    // rapport, pas une image à décoder.
    let mut by_image: BTreeMap<usize, Vec<collect::AtlasTexture>> = BTreeMap::new();
    let mut skipped: BTreeMap<&'static str, usize> = BTreeMap::new();
    for entry in &wanted {
        match textures
            .get(entry.texture)
            .ok_or("texture-out-of-bounds")
            .and_then(|t| {
                t.get("source")
                    .and_then(Value::as_u64)
                    .ok_or("texture-without-image")
            }) {
            Ok(image) => by_image.entry(image as usize).or_default().push(*entry),
            Err(reason) => *skipped.entry(reason).or_default() += 1,
        }
    }
    let done = AtomicUsize::new(0);
    let total = by_image.len();
    let results: Vec<_> = by_image
        .par_iter()
        .map(|(&image_index, readers)| {
            check(inputs.o)?;
            let outcome = bake::one_image(inputs, images, image_index, readers);
            let completed = done.fetch_add(1, Ordering::Relaxed) + 1;
            progress(json!({"phase":"textures","completed":completed,"total":total}));
            Ok(outcome)
        })
        .collect::<Result<Vec<_>>>()?;
    let mut previews = Vec::new();
    let mut shapes = BTreeMap::new();
    let mut notes: BTreeMap<&'static str, usize> = BTreeMap::new();
    for outcome in results {
        match outcome {
            Ok(baked) => {
                shapes.extend(baked.shapes);
                for note in baked.notes {
                    *notes.entry(note).or_default() += 1;
                }
                previews.extend(baked.previews);
            }
            Err((reason, count)) => *skipped.entry(reason).or_default() += count,
        }
    }
    previews.sort_by_key(|p| (p.texture, p.kind));
    let report = bake::report(&wanted, &previews, &skipped, &notes);
    Ok((previews, shapes, report))
}
