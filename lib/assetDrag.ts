/**
 * Dépôt d'un média de la bibliothèque vers la timeline.
 *
 * Le drag HTML5 natif n'est pas utilisable partout : il n'existe pas du tout
 * sur iPad/iOS, et sur Safari desktop il est bloqué par le `user-select: none`
 * appliqué à <body>. On passe donc par les Pointer Events (souris, tactile,
 * stylet) et on communique le dépôt à la timeline via un événement window.
 */

export type AssetDropPayload = {
  name: string;
  type: string;
  src: string;
  /** Position du pointeur au moment du lâcher, en coordonnées viewport. */
  clientX: number;
  clientY: number;
};

/** Ajout sans viser la timeline : le clip est inséré à la tête de lecture. */
export type AssetAddPayload = Omit<AssetDropPayload, 'clientX' | 'clientY'>;

export const ASSET_DROP_EVENT = 'fullcrea:asset-drop';
export const ASSET_ADD_EVENT = 'fullcrea:asset-add';

/** Sélecteur du conteneur de timeline, utilisé pour la détection de survol. */
export const TIMELINE_SELECTOR = '.timeline-container';

export function emitAssetDrop(payload: AssetDropPayload) {
  window.dispatchEvent(new CustomEvent<AssetDropPayload>(ASSET_DROP_EVENT, { detail: payload }));
}

export function emitAssetAdd(payload: AssetAddPayload) {
  window.dispatchEvent(new CustomEvent<AssetAddPayload>(ASSET_ADD_EVENT, { detail: payload }));
}

/** Vrai si le point (viewport) tombe sur la timeline. */
export function isOverTimeline(clientX: number, clientY: number): boolean {
  const el = document.elementFromPoint(clientX, clientY);
  return !!el?.closest(TIMELINE_SELECTOR);
}
