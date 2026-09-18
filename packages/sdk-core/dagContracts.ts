/** Un DAG que le compilateur n'a pas fait monter : le niveau le plus grossier est ce qui se
 *  dessine au loin, une primitive sans racine unique se dessine fine à toute distance. `DAG_FLAT`
 *  n'a aucun niveau grossier, `DAG_ROOTS` garde plus d'une racine par huit pages ; `groups` compte
 *  les groupes par issue. */
export interface DagWarning {
  code: 'DAG_FLAT' | 'DAG_ROOTS';
  roots: number;
  pages: number;
  groups: Record<string, number>;
}
/** Le rapport du DAG d'une primitive, jamais un contrat : seuls ses avertissements sont lus par
 *  le moteur. */
export interface DagReport {
  warnings?: DagWarning[];
}
