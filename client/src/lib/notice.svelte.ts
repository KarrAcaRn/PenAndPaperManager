/**
 * Hinweis, der einen Seitenwechsel überlebt (z.B. "Artikel angelegt, Bogen aber nicht"), angezeigt in GroupLayout.
 */
export const notice = $state({ text: '' });

export function showNotice(text: string): void {
  notice.text = text;
}

export function clearNotice(): void {
  notice.text = '';
}
