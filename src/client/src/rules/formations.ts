// Outfield positions for the home side attacking up. The away side mirrors them.
export const FORMS = {
  "4-4-2": [
    [110, 880],
    [250, 880],
    [430, 880],
    [570, 880],
    [120, 730],
    [265, 720],
    [415, 720],
    [560, 730],
    [265, 625],
    [415, 625],
  ],
  "4-3-3": [
    [110, 880],
    [250, 880],
    [430, 880],
    [570, 880],
    [170, 735],
    [340, 750],
    [510, 735],
    [120, 640],
    [340, 625],
    [560, 640],
  ],
  "3-5-2": [
    [170, 880],
    [340, 895],
    [510, 880],
    [80, 720],
    [210, 745],
    [340, 770],
    [470, 745],
    [600, 720],
    [265, 630],
    [415, 630],
  ],
  "5-3-2": [
    [70, 820],
    [195, 880],
    [340, 900],
    [485, 880],
    [610, 820],
    [170, 735],
    [340, 750],
    [510, 735],
    [265, 630],
    [415, 630],
  ],
  "4-5-1": [
    [110, 880],
    [250, 880],
    [430, 880],
    [570, 880],
    [80, 715],
    [210, 735],
    [340, 760],
    [470, 735],
    [600, 715],
    [340, 625],
  ],
  "4-2-3-1": [
    [110, 885],
    [250, 885],
    [430, 885],
    [570, 885],
    [265, 785],
    [415, 785],
    [140, 680],
    [340, 690],
    [540, 680],
    [340, 625],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;

export type FormationName = keyof typeof FORMS;
export const FORMATION_NAMES = Object.keys(FORMS) as FormationName[];
export const isFormation = (v: unknown): v is FormationName =>
  typeof v === "string" && Object.hasOwn(FORMS, v);

/** "club" means the club's own usual shape. */
export type FormChoice = "club" | FormationName;
