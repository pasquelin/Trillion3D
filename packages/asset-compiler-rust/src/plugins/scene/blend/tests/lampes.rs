//! Les lampes du pilote `blend`, prouvées sur une SDNA écrite ici même.
//!
//! La fixture CC0 du dépôt ne porte aucune lampe, et le dépôt ne fabrique pas de `.blend` : comme
//! pour l'ancienne disposition d'entête, le fichier est donc écrit à partir de la description
//! publique du format — une SDNA d'une seule structure `Lamp`, et un bloc de données typé par elle.
//! C'est exactement ce que le pilote lira d'un vrai fichier : la même structure, demandée par les
//! mêmes noms de champs.
use super::*;

/// Les champs de la structure `Lamp` que ce lecteur demande, dans l'ordre où la SDNA les décrit.
const FIELDS: [(&str, &str); 12] = [
    ("short", "type"),
    ("float", "r"),
    ("float", "g"),
    ("float", "b"),
    ("float", "energy_new"),
    ("float", "exposure"),
    ("float", "radius"),
    ("float", "spotsize"),
    ("float", "spotblend"),
    ("short", "area_shape"),
    ("float", "area_size"),
    ("float", "area_sizey"),
];
/// L'échelle du monde de l'objet qui porte la lampe : le rayon d'émetteur la traverse.
const SCALE: f64 = 2.0;

/// Un fichier Blender d'une seule structure `Lamp`, et un bloc de données par lampe donnée. Chaque
/// lampe est décrite par les valeurs de `FIELDS`, dans le même ordre.
fn lamp_file(lamps: &[[f32; 12]]) -> Vec<u8> {
    let mut sdna = Vec::new();
    sdna.extend_from_slice(b"SDNA");
    let names: Vec<Vec<u8>> = FIELDS
        .iter()
        .map(|(_, name)| format!("{name}\0").into_bytes())
        .collect();
    section(&mut sdna, b"NAME", &names);
    let types = [b"short\0".to_vec(), b"float\0".to_vec(), b"Lamp\0".to_vec()];
    section(&mut sdna, b"TYPE", &types);
    sdna.extend_from_slice(b"TLEN");
    for length in [2u16, 4, span() as u16] {
        sdna.extend_from_slice(&length.to_le_bytes());
    }
    sdna.extend_from_slice(&[0, 0]);
    sdna.extend_from_slice(b"STRC");
    sdna.extend_from_slice(&1u32.to_le_bytes());
    sdna.extend_from_slice(&2u16.to_le_bytes());
    sdna.extend_from_slice(&(FIELDS.len() as u16).to_le_bytes());
    for (rank, (kind, _)) in FIELDS.iter().enumerate() {
        let kind = u16::from(*kind == "float");
        sdna.extend_from_slice(&kind.to_le_bytes());
        sdna.extend_from_slice(&(rank as u16).to_le_bytes());
    }
    let mut out = b"BLENDER-v405".to_vec();
    block(&mut out, b"DNA1", 0, 0, &sdna);
    for (rank, values) in lamps.iter().enumerate() {
        block(&mut out, b"DATA", 0, 0x4242 + rank as u64, &packed(values));
    }
    block(&mut out, b"ENDB", 0, 0, &[]);
    out
}

/// La taille d'une `Lamp` : la somme de ses champs, sans remplissage, comme la SDNA les enchaîne.
fn span() -> usize {
    FIELDS
        .iter()
        .map(|(kind, _)| if *kind == "float" { 4 } else { 2 })
        .sum()
}

/// Les octets d'une lampe : chaque valeur écrite à la largeur que son champ déclare.
fn packed(values: &[f32; 12]) -> Vec<u8> {
    let mut out = Vec::with_capacity(span());
    for ((kind, _), value) in FIELDS.iter().zip(values) {
        if *kind == "float" {
            out.extend_from_slice(&value.to_le_bytes());
        } else {
            out.extend_from_slice(&(*value as i16).to_le_bytes());
        }
    }
    out
}

/// Les lampes que ce fichier donne au pilote, converties, et ce qu'il a compté.
fn converted(lamps: &[[f32; 12]], names: &[&str]) -> (Vec<Value>, Out) {
    let bytes = lamp_file(lamps);
    let file = BlendFile::open(&bytes, MAX_BYTES).expect("le fichier écrit pour ce test");
    let mut out = Out::new();
    for (block, name) in file.of(*b"DATA").zip(names) {
        let view = file.view(block).expect("la vue de la lampe");
        light::build(Some(view), (*name).to_string(), SCALE, &mut out);
    }
    (out.lights.clone(), out)
}

// Comportement : les quatre types de lampe que Blender écrit deviennent des lampes glTF, chaque
// champ étant demandé par son nom à la SDNA — puissance, exposition, couleur, cône — et le rayon
// d'émetteur venant de la donnée native, porté en mètres du monde par l'échelle de l'objet.
#[test]
fn the_four_blender_lamp_types_become_gltf_lights_with_their_native_emitter_radius() {
    // type, r, g, b, energy_new, exposure, radius, spotsize, spotblend, area_shape, x, y
    let lamps = [
        [
            0.0, 1.0, 0.5, 0.25, 1000.0, 0.0, 0.25, 0.0, 0.0, 0.0, 0.0, 0.0,
        ],
        [1.0, 1.0, 1.0, 1.0, 3.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        [
            2.0, 1.0, 1.0, 1.0, 100.0, 0.0, 0.125, 1.0, 0.5, 0.0, 0.0, 0.0,
        ],
        [4.0, 1.0, 1.0, 1.0, 50.0, 0.0, 0.0, 0.0, 0.0, 1.0, 3.0, 4.0],
    ];
    let names = ["Ampoule", "Soleil", "Projecteur", "Panneau"];
    let (lights, out) = converted(&lamps, &names);
    // La puissance en watts se répartit sur la sphère pour une ponctuelle et un projecteur, sur
    // l'hémisphère lambertien pour une surface, et la force d'un soleil est déjà un éclairement ;
    // le facteur 683 est la candela par watt par stéradian. Les produits sont écrits dans l'ordre
    // où la conversion les pose, la dernière décimale d'un flottant dépendant de cet ordre.
    let sphere = 1.0 / (4.0 * std::f64::consts::PI);
    let disc = 1.0 / std::f64::consts::PI;
    assert_eq!(
        json!(lights),
        json!([
            {"name":"Ampoule","type":"point","color":[1.0,0.5,0.25],
             "intensity":1000.0 * sphere * 683.0,"extras":{"emitterRadius":0.5}},
            {"name":"Soleil","type":"directional","color":[1.0,1.0,1.0],
             "intensity":6.0 * 683.0},
            {"name":"Projecteur","type":"spot","color":[1.0,1.0,1.0],
             "intensity":100.0 * sphere * 683.0,"extras":{"emitterRadius":0.25},
             "spot":{"innerConeAngle":0.25,"outerConeAngle":0.5}},
            {"name":"Panneau","type":"point","color":[1.0,1.0,1.0],
             "intensity":50.0 * disc * 683.0,"extras":{"emitterRadius":5.0}},
        ]),
        "les lampes converties depuis la SDNA ont changé"
    );
    assert!(
        out.report.unsupported.is_empty(),
        "rien ne devait être refusé"
    );
}

// Comportement : un type de lampe que ce pilote ne rend pas — le `hemi` des fichiers d'avant
// Blender 2.8 — est compté par son nom, et n'entre pas dans la scène.
#[test]
fn a_lamp_type_this_driver_does_not_convert_is_counted_by_its_name() {
    let hemi = [3.0, 1.0, 1.0, 1.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    let (lights, out) = converted(&[hemi], &["Hemi"]);
    assert!(lights.is_empty(), "aucune lampe ne devait sortir");
    assert_eq!(
        out.report.unsupported.get("blend-light-type-unsupported"),
        Some(&1)
    );
}
