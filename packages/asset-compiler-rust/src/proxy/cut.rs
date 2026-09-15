use super::{PROXY_ERROR_METRES, PROXY_TRIANGLE_FLOATS};
use crate::dag::DagCluster;

/// Doublements du seuil qu'une coupe s'autorise avant d'abandonner : le seizième vaut soixante-cinq
/// mille fois le premier, donc les racines du DAG, au-delà desquelles il n'y a plus rien de plus
/// grossier. Une borne connue, et non une boucle qui s'arrête quand elle veut.
const ERROR_LADDER: usize = 16;

/// Les clusters d'une coupe plate au seuil donné : erreur certifiée sous le seuil, remplaçant
/// au-dessus.
///
/// C'est exactement la coupe que le moteur utilise pour l'écran, seuil en mètres au lieu de pixels :
/// `lod_error <= t < parent_error`. Les deux quantités sont monotones le long du DAG, donc cette
/// règle couvre la surface une fois et une seule — ni trou, ni double couche. Une racine a un
/// `parent_error` infini : elle est retenue dès que son erreur passe le seuil, et sinon ce sont ses
/// enfants qui le font, parce que leur remplaçant est justement cette racine trop grossière.
fn selected(cluster: &DagCluster, threshold: f64) -> bool {
    cluster.lod_error <= threshold && cluster.parent_error > threshold
}

fn triangles_at(dag: &[DagCluster], threshold: f64) -> usize {
    dag.iter()
        .filter(|cluster| selected(cluster, threshold))
        .map(DagCluster::triangles)
        .sum()
}

/// Ce qu'une primitive demande à sa coupe : un seuil d'erreur et une part du budget de triangles.
#[derive(Clone, Copy)]
pub struct CutDemand {
    /// Le seuil de départ, en espace objet : l'appelant l'a déjà ramené par l'échelle monde.
    pub threshold: f64,
    /// Les triangles que cette primitive s'autorise dans le proxy de la scène.
    pub budget: usize,
}

/// La coupe la plus fine qui tient dans le budget de triangles, et le seuil qu'elle a demandé.
///
/// Le seuil de départ est celui de la spécification, en mètres ; tant que la coupe ne tient pas
/// dans sa part du budget, il double — et il cesse de doubler dès qu'il ne retire plus rien, parce
/// que les racines du DAG sont un plancher que la simplification du proxy franchira, pas lui.
///
/// C'est une règle de taille, générique et sans nom de scène : une primitive dessinée mille fois
/// reçoit une part mille fois plus petite et sort mille fois plus grossière, une petite pièce garde
/// son seuil de départ. Le seuil réellement obtenu est publié.
///
/// Le seuil est exprimé en espace objet : l'appelant l'a déjà divisé par l'échelle monde du nœud
/// qui place la primitive, si bien qu'il vaut des mètres une fois la coupe placée.
pub fn coarse_cut(dag: &[DagCluster], positions: &[f32], demand: CutDemand) -> (f64, Vec<f32>) {
    let mut threshold = demand.threshold;
    let mut triangles = triangles_at(dag, threshold);
    for _ in 0..ERROR_LADDER {
        if triangles <= demand.budget {
            break;
        }
        let wider = threshold * 2.0;
        let fewer = triangles_at(dag, wider);
        // Le DAG a un plancher : ses racines. Un seuil qui ne retire plus un triangle ne sert
        // qu'à publier une erreur que la coupe n'a jamais prise ; la simplification propre au
        // proxy, elle, descend plus bas. On s'arrête donc au plus petit seuil qui atteint ce
        // plancher, et c'est celui-là qui est publié.
        if fewer >= triangles {
            break;
        }
        threshold = wider;
        triangles = fewer;
    }
    let mut out: Vec<f32> = Vec::with_capacity(triangles * PROXY_TRIANGLE_FLOATS);
    for cluster in dag.iter().filter(|cluster| selected(cluster, threshold)) {
        for index in &cluster.indices {
            let base = *index as usize * 3;
            // Un cluster nomme les sommets de la source : un index hors du tampon serait une
            // partition invalide, que le compilateur a déjà refusée avant d'arriver ici.
            out.push(positions[base]);
            out.push(positions[base + 1]);
            out.push(positions[base + 2]);
        }
    }
    (threshold, out)
}

/// Ce qu'une primitive demande à sa coupe, calculé une fois par primitive.
///
/// Le seuil monde publié est ramené en espace objet par l'échelle la plus grande qui place la
/// primitive — une échelle absente ou nulle le laisse tel quel, rien n'est deviné. La part est
/// proportionnelle à ce que la primitive pèse dans la scène une fois toutes ses instances posées :
/// le facteur d'instance s'annule, puisqu'une primitive posée mille fois pèse mille fois plus et
/// que sa part par instance est donc mille fois plus petite. Jamais moins d'un cluster : rien ne
/// disparaît du proxy, même dans une scène de cent mille objets.
pub fn cut_demand(
    scale: Option<f64>,
    budget: usize,
    triangles: usize,
    scene_triangles: usize,
) -> CutDemand {
    let threshold = match scale {
        Some(value) if value.is_finite() && value > 0.0 => PROXY_ERROR_METRES / value,
        _ => PROXY_ERROR_METRES,
    };
    let share = if scene_triangles == 0 {
        budget
    } else {
        (budget as u128 * triangles as u128 / scene_triangles as u128) as usize
    };
    CutDemand {
        threshold,
        budget: share.max(crate::dag::DAG_CLUSTER_TRIANGLES),
    }
}
