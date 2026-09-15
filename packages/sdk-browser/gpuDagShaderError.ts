/**
 * Erreur écran du noyau de sélection du DAG, en WGSL : la borne `screenErrorBound` de sdk-core
 * (preuve au site de la formule, `projectionOracles.ts`), mêmes opérandes et même ordre, en f32.
 * Miroir CPU : `projectedError` de `gpuDagOracleMath.ts`. Les déclarations de module WGSL se
 * lisent dans n'importe quel ordre : ce morceau s'ajoute au texte de `gpuDagShader.ts`.
 */
export const DAG_ERROR_WGSL = `
/** Majorant du déplacement écran de tout point de la sphère déplacé d'au plus \`error\` : profondeur
 *  minimale m, distance a l'axe l, rayon et erreur etires rho et delta,
 *  E = (delta*f/m)*(sqrt(m*m+(l+rho)^2)/(m-delta)) ; plan proche atteint : INF. */
fn projected(error:f32,sphere:vec4f,e:mat4x4f,stretch:f32,focal:f32)->f32{
 if(error==0.0){return 0.0;}
 if(!(error>0.0)){return INF;}
 let v=(e*vec4f(sphere.xyz,1.0)).xyz;
 let reach=sphere.w*stretch;let shift=error*stretch;
 let nearest=-v.z-reach;let closest=nearest-shift;let side=sqrt(v.x*v.x+v.y*v.y)+reach;
 let slant=sqrt(nearest*nearest+side*side);
 if(!(closest>uni.near)||!(slant>=nearest&&slant<INF)){return INF;}
 return ((shift*focal)/nearest)*(slant/closest);
}
fn selects(cluster:Cluster,e:mat4x4f,stretch:f32,focal:f32,threshold:f32)->bool{
 if(projected(cluster.lodError,cluster.sphere,e,stretch,focal)>threshold){return false;}
 return projected(cluster.parentError,cluster.parentSphere,e,stretch,focal)>threshold;
}
fn focalPixels()->f32{return max(uni.pixelScale.x,uni.pixelScale.y);}
`;
