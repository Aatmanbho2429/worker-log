/**
 * The colour a grade is drawn in, by its position in the register's grade list.
 *
 * Position rather than id, so the two grades the app ships with keep the navy
 * and the red the floor already reads them by, and a grade added later takes
 * the next tone rather than whatever its id happens to land on.
 *
 * The classes themselves live in `styles/components/_grades.scss`; each one
 * only sets custom properties, and the screen decides what to paint with them.
 */
const TONES = 6;

export function gradeToneClass(index: number): string {
  // A repeated colour past the end of the palette is a smaller problem than an
  // unreadable one, and every grade is labelled with its name anyway.
  return `g-tone-${((index % TONES) + TONES) % TONES}`;
}
