// World units: the pitch is portrait and y = 0 is the top goal line. Values match the prototype.
export const W = 680;
export const H = 1050;
export const CX = W / 2;
export const GW = 150;
export const GD = 30;

export const RP = 15;
export const RB = 8;
export const KR = 15;
export const POST_R = 5;
export const PLAYER_MASS = 3;
export const BALL_MASS = 1;

export const DEC_P = 520;
export const DEC_B = 210;
export const LIN_P = 0.8;
export const LIN_B = 0.3;
export const E = 0.8;

export const MAXV = 1500;
export const MINV = 90;
export const MAXDRAG = 150;
/**
 * On-screen pull (CSS pixels) for full power, whatever size the pitch is drawn: a phone draws it
 * small, so pulls are measured on screen rather than on the pitch. A finger gets a longer pull
 * than a mouse (bigger movements, smaller pixels): both are about 2–2.5 cm.
 */
export const FULL_PULL_PX = { mouse: 100, touch: 150 } as const;
/** Drags shorter than this cancel the flick. */
export const MIN_DRAG = 12;

/** Visible world rectangle. */
export const VX0 = -50;
export const VY0 = -58;
export const VW = 780;
export const VH = 1166;

/** Shooting-area lines: [top, bottom]. */
export const ZONE = [350, H - 350] as const;

export const SUBSTEPS = 6;
export const MAX_DT = 0.05;
export const STOP_SPEED = 3;
export const MAX_FLICK_TIME = 9;
/** How far players may slide beyond the touchlines. */
export const RUN_OFF = 34;
/** Keepers' goal line offset from the end line. */
export const KEEPER_LINE = 14;
/** The goal area (the small box): half its width and its depth from the end line. */
export const GOAL_AREA_HW = 91.5;
export const GOAL_AREA_D = 55;
/** A keeper's kick: ball speed per unit of slingshot speed (a kick from the hands, not a full hit). */
export const KEEPER_KICK = 0.8;

/** Power rises along this curve, so short and medium pulls are softer; a full pull is unchanged. */
export const POWER_CURVE = 1.5;

/** Launch speed for a pull of distance d (before the direction is applied). */
export const launchSpeed = (d: number): number =>
  MINV + (Math.min(d, MAXDRAG) / MAXDRAG) ** POWER_CURVE * (MAXV - MINV);
