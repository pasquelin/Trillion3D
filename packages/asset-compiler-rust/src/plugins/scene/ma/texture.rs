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
    Some(slot(world, index, sampler))
}

/// Le rang de l'image, versée à la première demande, ou rien quand le fichier ne se lit pas.
fn image(world: &mut World<'_>, written: &str) -> Option<usize> {
    let images = world.images;
    let Some((relative, decoder)) = candidates(written)
        .into_iter()
        .find_map(|path| readable(images, &path).map(|decoder| (path, decoder)))
    else {
        world.refuse(report::TEXTURE_MISSING);
        world.scene.report.notes.push(format!(
            "texture illisible ou hors registre d'images: {written}"
        ));
        return None;
    };
    if let Some(known) = world.images_by_uri.get(&relative) {
        return Some(*known);
    }
    let name = relative.rsplit('/').next().unwrap_or(&relative).to_string();
    // Une URI glTF, pas le chemin sous la racine : `%`, `#`, l'espace et tout ce qui n'est pas un
    // caractère non réservé s'échappe, sinon le consommateur relit un autre nom, ou rien.
    let uri = crate::uri::encode_relative(Path::new(&relative));
    world
        .scene
        .images
        .push(json!({"name":name,"mimeType":decoder,"uri":uri}));
    let index = world.scene.images.len() - 1;
    world.images_by_uri.insert(relative, index);
    Some(index)
}

/// Les chemins où chercher l'image sous la racine, dans l'ordre : le chemin écrit quand il est
/// relatif et sûr, puis son seul nom de fichier à la racine des images, puis ce nom sous
/// `sourceimages`.
fn candidates(written: &str) -> Vec<String> {
    let parts: Vec<&str> = written
        .split(['/', '\\'])
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    let Some(name) = parts.last().filter(|name| crate::is_safe_source_name(name)) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    if !written.starts_with('/')
        && !written.contains(':')
        && parts.iter().all(|part| crate::is_safe_source_name(part))
    {
        out.push(parts.join("/"));
    }
    out.push((*name).to_string());
    out.push(format!("{IMAGES_DIRECTORY}/{name}"));
    out
}

/// Le type MIME du pilote d'image qui revendique cette URI sous la racine, quand le fichier y est.
fn readable(root: &Path, uri: &str) -> Option<&'static str> {
    let path = root.join(uri);
    crate::plugins::image::by_extension(&path)
        .filter(|_| path.is_file())
        .map(|decoder| decoder.mime())
}

/// Le rang de la texture qui lie cette image à cet échantillonneur, versée une seule fois.
fn slot(world: &mut World<'_>, source: usize, sampler: usize) -> Value {
    let entry = json!({"source":source,"sampler":sampler});
    let known = world.scene.textures.iter().position(|kept| *kept == entry);
    let index = known.unwrap_or_else(|| {
        world.scene.textures.push(entry);
        world.scene.count("textures", 1);
        world.scene.textures.len() - 1
    });
    json!({ "index": index })
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
