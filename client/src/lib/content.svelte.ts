/**
 * Wird nach Änderungen an Ordnern oder Artikeln hochgezählt, die nicht ohnehin zu einem Routenwechsel führen
 * (z.B. Ordner anlegen), damit Ansichten wie der Ordnerbaum neu laden.
 */
export const contentChanges = $state({ version: 0 });

export function notifyContentChanged(): void {
  contentChanges.version++;
}
