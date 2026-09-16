//! Un `UsdUVTexture` vers une texture glTF.
//!
//! Le pilote ne décode rien lui-même : il nomme l'image par son URI, relativement à la racine où le
//! compilateur relira ces mêmes octets, et laisse le registre d'images dire si ce format se lit.
//! Une texture d'un format hors registre, absente, ou qui sort du dossier de la source est comptée
//! au rapport et la scène continue sans elle — jamais un échec de compilation.
use super::*;

/// L'identifiant du nœud de texture que ce pilote lit.
const UV_TEXTURE: &str = "UsdUVTexture";
/// Le jeu de coordonnées que la scène intermédiaire porte : glTF n'en reçoit qu'un ici.
const UV_SET: &str = "st";
/// Le motif d'un jeu de textures par tuile, qui désigne plusieurs fichiers et non un.
const UDIM: &str = "<UDIM>";

/// Ce qu'une texture accrochée rend à l'entrée qui la lit : son emplacement glTF, et le facteur
/// que glTF porte à la place du `scale` du nœud de texture — un pour un `scale` absent.
pub(super) struct Bound {
    pub(super) value: Value,
    /// Le facteur unique auquel `scale` et `bias` se ramènent, `None` quand ils n'y tiennent pas.
    scale: Option<f64>,
}

impl Bound {
    /// Le facteur à écrire là où glTF en a un ; un `scale` qui ne s'y ramène pas est compté.
    pub(super) fn factor(&self, world: &mut World<'_>) -> f64 {
        self.scale.unwrap_or_else(|| {
            world.refuse(world::TEXTURE_SCALE);
            1.0
        })
    }
    /// L'emplacement seul, là où glTF n'a pas de facteur : un `scale` qui ne vaut pas un est compté.
    pub(super) fn plain(self, world: &mut World<'_>) -> Value {
        if self.scale != Some(1.0) {
            world.refuse(world::TEXTURE_SCALE);
        }
        self.value
    }
}

/// La texture glTF que cette connexion désigne. `colour` dit le rôle de l'entrée qui la lit — une
/// couleur ou une donnée —, ce dont dépend l'espace de couleur que le fichier doit porter.
pub(super) fn resolve(world: &mut World<'_>, target: &sdf::Path, colour: bool) -> Option<Bound> {
    let shader = world.stage.prim(target.prim_path()).ok()?;
    let id = read::first(&shader.attribute("info:id")).and_then(|(value, _)| read::text(&value));
    if id.as_deref() != Some(UV_TEXTURE) {
        world.refuse(world::TEXTURE_UNSUPPORTED);
        return None;
    }
    let (value, _) = read::first(&shader.attribute("inputs:file"))?;
    let file = read::asset(&value)?;
    if file.as_str().contains(UDIM) {
        world.refuse(world::TEXTURE_UNSUPPORTED);
        return None;
    }
    if uv_set(world, &shader).as_deref().unwrap_or(UV_SET) != UV_SET {
        world.refuse(world::TEXTURE_UNSUPPORTED);
    }
    let index = image(world, file)?;
    sampling::colour_space(world, &shader, colour);
    let sampler = sampling::sampler(world, &shader);
    Some(Bound {
        value: json!({ "index": world.scene.texture(index, sampler) }),
        scale: sampling::scale(&shader),
    })
}

/// Le rang de l'image, versée à la première demande, ou `None` quand le fichier ne se lit pas.
fn image(world: &mut World<'_>, file: &sdf::AssetPath) -> Option<usize> {
    let Some(relative) = under_root(world, file) else {
        world.refuse(world::TEXTURE_MISSING);
        return None;
    };
    let Some(mime) = crate::import::readable(world.images, &relative) else {
        world.refuse(world::TEXTURE_MISSING);
        world.scene.image_unreadable(&relative);
        return None;
    };
    Some(world.scene.image(relative, mime))
}

/// Le chemin de l'image sous la racine où le compilateur relira ses octets. Un chemin d'asset
/// s'ancre sur la couche qui l'écrit — référence, sous-couche ou charge —, et c'est ce chemin
/// résolu qui revient sous la racine : une couche rangée dans un sous-dossier y trouve ses images.
/// Faute de résolution, le chemin écrit est ancré sur la racine, comme une couche seule le demande.
fn under_root(world: &World<'_>, asset: &sdf::AssetPath) -> Option<String> {
    let under = asset
        .resolved_path()
        .map(Path::new)
        .and_then(|path| path.strip_prefix(&world.root).ok())
        .map(|path| path.to_string_lossy().replace('\\', "/"));
    // Une couche USD sépare les segments d'un chemin d'asset par une barre oblique, et une seule :
    // une barre inverse y appartient au nom, elle n'y coupe rien.
    crate::safe_relative(under.as_deref().unwrap_or(asset.as_str()), &['/'])
}

/// Le jeu de coordonnées que le lecteur de primvar branché sur `inputs:st` désigne.
fn uv_set(world: &World<'_>, shader: &usd::Prim) -> Option<String> {
    let target = shader
        .attribute("inputs:st")
        .connections()
        .ok()?
        .into_iter()
        .next()?;
    let reader = world.stage.prim(target.prim_path()).ok()?;
    read::first(&reader.attribute("inputs:varname")).and_then(|(value, _)| read::text(&value))
}
