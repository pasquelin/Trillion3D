//! Un nœud `file` de Maya vers une texture glTF.
//!
//! Le pilote ne décode rien lui-même : il nomme l'image par son URI, relativement à la racine où le
//! compilateur relira ces mêmes octets, et laisse le registre d'images dire si ce format se lit.
//! Une image absente, hors du dossier de la source ou hors du registre est comptée au rapport, et la
//! scène continue sans elle — jamais un échec de compilation.
//!
//! Maya écrit souvent un chemin absolu de la machine qui a exporté. Ce chemin n'existe pas ici, et
//! le suivre sortirait du dossier servi : seul son nom de fichier est retenu, cherché à la racine
//! des images puis dans `sourceimages`, le dossier que Maya donne aux textures d'un projet.
use super::*;

/// Le dossier qu'un projet Maya réserve aux textures.
const IMAGES_DIRECTORY: &str = "sourceimages";
/// Ce qui sépare les segments d'un chemin écrit par Maya : la machine qui a exporté peut être une
/// machine Windows, et le chemin qu'elle a écrit porte alors des barres inverses.
const SEPARATORS: &[char] = &['/', '\\'];
/// Les deux modes de répétition d'un échantillonneur glTF : répéter, ou borner au dernier texel.
const REPEAT: u32 = 10497;
const CLAMP: u32 = 33071;
/// Les composantes du placage d'un `place2dTexture` qu'un glTF sans `KHR_texture_transform` ne
/// porte pas, chacune avec la valeur qui ne déplace rien. Maya les écrit d'un bloc ou composante
/// par composante, et les deux écritures disent la même chose.
const PLACEMENTS: &[(&[&str], f64)] = &[
    (&["re", "repeatUV"], 1.0),
    (&["reu", "repeatU"], 1.0),
    (&["rev", "repeatV"], 1.0),
    (&["of", "offset"], 0.0),
    (&["ofu", "offsetU"], 0.0),
    (&["ofv", "offsetV"], 0.0),
    (&["ro", "rotateUV"], 0.0),
];
/// Les deux miroirs d'un `place2dTexture` : aucun mode de répétition de glTF ne fait ce pliage.
const MIRRORS: &[&[&str]] = &[&["mu", "mirrorU"], &["mv", "mirrorV"]];

/// La texture glTF branchée sur l'une de ces entrées d'un nœud, sous la forme que glTF attend d'un
/// emplacement de texture : `{"index": …}`.
pub(super) fn connected(world: &mut World<'_>, node: usize, names: &[&str]) -> Option<Value> {
    let source = world.graph.input(node, names).map(|(source, _)| source)?;
    of(world, source)
}

/// La texture glTF de ce nœud. Une entrée branchée sur autre chose qu'un nœud `file` — un calcul,
/// une rampe, un bruit — n'est pas une image : elle est comptée plutôt qu'évaluée.
pub(super) fn of(world: &mut World<'_>, node: usize) -> Option<Value> {
    let document = world.document;
    if document.nodes[node].kind != "file" {
        world.refuse(report::TEXTURE_UNSUPPORTED);
        return None;
    }
    let written = document.nodes[node]
        .attr(&["ftn", "fileTextureName"])
        .and_then(|attr| attr.texts().first().cloned())?;
    let index = image(world, &written)?;
    let sampler = sampler(world, node);
    Some(json!({ "index": world.scene.texture(index, sampler) }))
}

/// Le rang de l'image, versée à la première demande, ou rien quand le fichier ne se lit pas.
fn image(world: &mut World<'_>, written: &str) -> Option<usize> {
    let images = world.images;
    let Some((relative, mime)) = candidates(written)
        .into_iter()
        .find_map(|path| crate::import::readable(images, &path).map(|mime| (path, mime)))
    else {
        world.refuse(report::TEXTURE_MISSING);
        world.scene.image_unreadable(written);
        return None;
    };
    Some(world.scene.image(relative, mime))
}

/// Les chemins où chercher l'image sous la racine, dans l'ordre : le chemin écrit quand il est
/// relatif et sûr, puis son seul nom de fichier à la racine des images, puis ce nom sous
/// `sourceimages`.
fn candidates(written: &str) -> Vec<String> {
    let name = written
        .rsplit(SEPARATORS)
        .find(|part| !part.is_empty() && *part != ".")
        .filter(|name| crate::is_safe_source_name(name));
    let Some(name) = name else {
        return Vec::new();
    };
    let mut out: Vec<String> = crate::safe_relative(written, SEPARATORS)
        .into_iter()
        .collect();
    out.push(name.to_string());
    out.push(format!("{IMAGES_DIRECTORY}/{name}"));
    out
}

/// L'échantillonneur de ce nœud `file`, lu sur le `place2dTexture` branché sur ses coordonnées.
/// Maya répète par défaut, et `wrapU` comme `wrapV` bornent séparément l'axe qu'ils nomment. Ce
/// même nœud porte le placage — répétition, décalage, rotation, miroir —, que la sortie ne porte
/// pas : ce qui ne passe pas est compté par son nom plutôt que perdu en silence.
fn sampler(world: &mut World<'_>, node: usize) -> usize {
    let document = world.document;
    let place = world
        .graph
        .input(node, &["uv", "uvCoord"])
        .map(|(source, _)| &document.nodes[source]);
    if let Some(place) = place {
        if MIRRORS
            .iter()
            .any(|names| place.attr(names).and_then(Attr::flag) == Some(true))
        {
            world.refuse(report::TEXTURE_MIRROR);
        }
        if PLACEMENTS
            .iter()
            .any(|(names, neutral)| moved(place, names, *neutral))
        {
            world.refuse(report::TEXTURE_TRANSFORM);
        }
    }
    let repeats = |names: &[&str]| match place
        .and_then(|place| place.attr(names))
        .and_then(Attr::flag)
        .unwrap_or(true)
    {
        true => REPEAT,
        false => CLAMP,
    };
    world
        .scene
        .sampler_uv(repeats(&["wu", "wrapU"]), repeats(&["wv", "wrapV"]))
}

/// Cette composante du placage est-elle écrite ailleurs qu'à sa valeur neutre ?
fn moved(place: &Node, names: &[&str], neutral: f64) -> bool {
    place
        .attr(names)
        .map(Attr::numbers)
        .is_some_and(|values| values.iter().any(|value| *value != neutral))
}
