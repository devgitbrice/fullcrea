export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

// Raccourcis globaux ignorés pendant la saisie, tant qu'une modale est ouverte
// (le focus peut être sur body après un clic dans la modale) et quand le focus
// est dans un popover/menu/listbox, où les touches ont leur propre sens.
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (isEditableTarget(e.target)) return true;
  if (document.querySelector('[aria-modal="true"]')) return true;
  const el = e.target instanceof Element ? e.target : null;
  const scope = el?.closest('[role="dialog"],[role="menu"],[role="listbox"]');
  // La zone des pistes de la timeline est un listbox dont les raccourcis
  // globaux (Suppr, Espace, Ctrl+B…) doivent rester actifs quand un clip a le
  // focus : elle se déclare avec data-shortcuts-passthrough.
  return !!scope && !scope.hasAttribute('data-shortcuts-passthrough');
}
