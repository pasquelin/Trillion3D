//! Ce qu'un parcours de scène USD a sous la main, et les noms de tout ce qu'il ne rend pas.
//!
//! Aucun de ces refus n'est un échec de compilation : un `PointInstancer` au milieu d'une scène ne
//! doit pas empêcher d'en voir les murs. Ils sont comptés, publiés dans `unsupported` du manifeste,
//! et le rapport dit combien de fois chacun a été rencontré. Une scène qui, après tout cela, ne
//! porte aucune surface visible est refusée, elle, par `IMPORT_EMPTY`.
use super::*;

/// Un `PointInstancer` : ses instances sont décrites par des tableaux parallèles et un prototype
/// indexé, que ce pilote ne déplie pas.
pub(super) const POINT_INSTANCER: &str = "usd-point-instancer-unsupported";
/// Des courbes (`BasisCurves`, `NurbsCurves`, `HermiteCurves`) : une courbe n'est pas une surface.
pub(super) const CURVES: &str = "usd-curves-unsupported";
/// Un volume (`Volume`, champs OpenVDB ou field3d) : pas une surface non plus.
pub(super) const VOLUME: &str = "usd-volume-unsupported";
/// Un squelette ou une animation de squelette (`SkelRoot`, `Skeleton`, `SkelAnimation`, `BlendShape`).
pub(super) const SKEL: &str = "usd-skel-unsupported";
/// Une caméra : une scène importée n'en apporte pas, l'hôte place la sienne.
pub(super) const CAMERA: &str = "usd-camera-unsupported";
/// Une lampe de `UsdLux` : l'éclairage de la scène ne vient pas de l'import.
pub(super) const LIGHT: &str = "usd-light-unsupported";
/// Une surface paramétrique que ce pilote ne pave pas (`NurbsPatch`).
pub(super) const PATCH: &str = "usd-patch-unsupported";
/// Un `Mesh` dont `subdivisionScheme` n'est pas `none` : les polygones sont rendus **plats**, sans
/// la subdivision demandée, ce qui change la silhouette de la surface.
pub(super) const SUBDIVISION: &str = "usd-subdivision-unsupported";
/// Un jeu de variantes est présent : seule la sélection par défaut de la composition est lue.
pub(super) const VARIANTS: &str = "usd-variants-unsupported";
/// Une référence, une charge (`payload`) ou une sous-couche que la composition n'a pas résolue —
/// le fichier visé est absent, illisible, ou le chemin ne se résout pas.
pub(super) const COMPOSITION: &str = "usd-composition-invalid";
/// Un attribut lu à son premier échantillon temporel, faute de valeur par défaut : la scène est
/// figée sur cette valeur, aucune animation n'est portée.
pub(super) const TIME_SAMPLE: &str = "usd-animation-first-sample";
/// Un `Mesh` dont les tableaux obligatoires manquent ou se contredisent.
pub(super) const MESH_INVALID: &str = "usd-mesh-invalid";
/// Une face qu'un `Mesh` déclare et que ses tableaux ne portent pas : un indice hors du tableau de
/// points, un indice négatif, moins de trois coins, ou un indice de primvar qui sort de son
/// tableau. Elle est retirée de la surface plutôt que repliée sur le premier point.
pub(super) const FACE_INVALID: &str = "usd-face-invalid";
/// Une face que la coupe par oreilles n'a pas su découper entièrement : polygone qui se recoupe, ou
/// sans plan — coins tous alignés, aire nulle. Elle sort en éventail depuis son premier coin, ce
/// qui peut la remplir au-delà de sa silhouette, et c'est ce que ce compte dit.
pub(super) const NGON_UNCUT: &str = "usd-ngon-untriangulable";
/// Une opération de transformation que ce pilote ne compose pas (`!resetXformStack!`, inverse d'une
/// matrice, opération de type inconnu).
pub(super) const XFORM_UNSUPPORTED: &str = "usd-xform-unsupported";
/// Une transformation dont les nombres ne sont pas finis : le nœud reste à l'identité.
pub(super) const XFORM_INVALID: &str = "usd-xform-invalid";
/// Un `Material` sans `UsdPreviewSurface` atteignable depuis `outputs:surface`.
pub(super) const SURFACE_UNSUPPORTED: &str = "usd-surface-unsupported";
/// Une texture dont le fichier est absent, ou hors du dossier de la source.
pub(super) const TEXTURE_MISSING: &str = "usd-texture-missing";
/// Une opacité portée par une image que la couleur de base ne porte pas : glTF ne lit l'alpha que
/// dans `baseColorTexture`, et deux images distinctes ne s'y ramènent pas sans en recomposer une
/// troisième. Le matériau garde alors l'opacité écrite, et rien de l'image d'opacité n'est versé.
pub(super) const OPACITY_TEXTURE: &str = "usd-opacity-texture-unsupported";
/// Une entrée branchée sur un canal que glTF ne lit pas à cette place : sa carte métal/rugosité
/// prend le métal dans le canal bleu et la rugosité dans le vert. La carte est portée telle quelle
/// et l'écart est compté.
pub(super) const TEXTURE_CHANNEL: &str = "usd-texture-channel-unsupported";
/// Un mode de répétition que glTF n'a pas — `black`, qui borde l'image de transparent, ou
/// `useMetadata`, qui laisse le fichier décider : la texture est répétée, comme USD le fait par
/// défaut, et l'écart est compté.
pub(super) const TEXTURE_WRAP: &str = "usd-texture-wrap-unsupported";
/// Un `scale` ou un `bias` de texture qu'un facteur glTF ne porte pas : glTF multiplie sa texture
/// par un facteur et n'y ajoute rien, donc un `bias` non nul, un `scale` différent d'un canal de
/// couleur à l'autre ou un `scale` d'alpha qui ne vaut pas un restent hors de la scène.
pub(super) const TEXTURE_SCALE: &str = "usd-texture-scale-unsupported";
/// Un `sourceColorSpace` contraire au rôle de l'entrée qui lit la texture : une couleur déclarée
/// `raw`, ou une donnée déclarée `sRGB`. Les octets passent tels quels, aucun n'est réencodé.
pub(super) const TEXTURE_COLOUR_SPACE: &str = "usd-texture-colour-space-unsupported";
/// Un `UsdPreviewSurface` décrit par son flux de travail spéculaire — `useSpecularWorkflow` ou une
/// couleur spéculaire écrite : le métal et la rugosité de glTF ne le portent pas, et l'approcher
/// par eux réinventerait la surface.
pub(super) const SPECULAR_WORKFLOW: &str = "usd-specular-workflow-unsupported";
/// Un vernis (`clearcoat` non nul, avec sa rugosité) : le glTF de base n'a pas cette couche.
pub(super) const CLEARCOAT: &str = "usd-clearcoat-unsupported";
/// Un indice de réfraction autre que celui par défaut : le glTF de base n'en porte pas.
pub(super) const IOR: &str = "usd-ior-unsupported";
/// Une normale écrite comme valeur, sans texture pour la porter : glTF n'a pas de normale
/// constante par matériau, et la surface garde celle de sa géométrie.
pub(super) const NORMAL_VALUE: &str = "usd-normal-value-unsupported";
/// Une texture que ce pilote ne peut pas accrocher telle quelle : jeu d'UV autre que celui porté,
/// motif `<UDIM>`, ou transformation d'UV déclarée.
pub(super) const TEXTURE_UNSUPPORTED: &str = "usd-texture-unsupported";

/// Ce qu'un parcours a sous la main : la scène en construction, la scène USD composée, et la racine
/// où les URI d'images se résolvent.
pub(super) struct World<'a> {
    pub(super) stage: &'a usd::Stage,
    pub(super) scene: &'a mut Scene,
    /// Le dossier contre lequel les URI relatives d'images se résolvent, `scene::image_root`.
    pub(super) images: &'a Path,
    /// Le même dossier sous sa forme canonique : la composition résout les chemins d'asset sous
    /// celle-là, et c'est elle qu'il faut retrancher pour retrouver l'URI d'une image.
    pub(super) root: PathBuf,
    /// Les matériaux déjà résolus, par chemin de prim ; `None` pour un matériau illisible.
    pub(super) materials: HashMap<String, Option<usize>>,
    /// Les maillages déjà construits, par (chemin de la donnée, matériaux liés) : deux instances du
    /// même prototype aux mêmes matériaux citent le même maillage glTF.
    pub(super) meshes: HashMap<(String, Vec<Option<usize>>), usize>,
    pub(super) cancelled: &'a AtomicBool,
}

impl World<'_> {
    /// L'annulation, vérifiée à chaque prim : le parcours s'arrête, `convert` refuse ensuite.
    pub(super) fn check(&self) -> Option<()> {
        (!self.cancelled.load(Ordering::Relaxed)).then_some(())
    }
    /// Compte un refus nommé une fois.
    pub(super) fn refuse(&mut self, reason: &str) {
        self.scene.report.add(reason);
    }
    /// Compte ce que le rapport publie en clair.
    pub(super) fn count(&mut self, what: &'static str, by: usize) {
        self.scene.count(what, by);
    }
}

/// Le refus nommé qu'appelle un type de prim que ce pilote ne rend pas, et `None` pour les types
/// qu'il traverse ou lit. Un type inconnu n'est pas refusé : il est traversé comme un groupe, ce qui
/// laisse passer les surfaces qu'il porte au lieu de couper une branche entière.
pub(super) fn refusal(type_name: &str) -> Option<&'static str> {
    Some(match type_name {
        "PointInstancer" => POINT_INSTANCER,
        "BasisCurves" | "NurbsCurves" | "HermiteCurves" => CURVES,
        "Volume" | "OpenVDBAsset" | "Field3DAsset" => VOLUME,
        "SkelRoot" | "Skeleton" | "SkelAnimation" | "BlendShape" => SKEL,
        "Camera" => CAMERA,
        "NurbsPatch" => PATCH,
        name if name.ends_with("Light") || name.ends_with("LightFilter") => LIGHT,
        _ => return None,
    })
}
