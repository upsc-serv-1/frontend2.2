// src/services/sm2.ts
// CLIENT-SIDE Spaced Repetition engine. Pure functions. Single source of truth.

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface SrsSettings {
  learningStepsMinutes: number[];
  graduatingIntervalDays: number;
  easyIntervalDays: number;
  startingEase: number;
  easyBonus: number;
  intervalModifier: number;
  hardMultiplier: number;
  maxIntervalDays: number;
  minEase: number;
  leechThreshold: number;
}

export const DEFAULT_SRS_SETTINGS: SrsSettings = {
  learningStepsMinutes: [1, 10],
  graduatingIntervalDays: 1,
  easyIntervalDays: 4,
  startingEase: 2.5,
  easyBonus: 1.3,
  intervalModifier: 1.0,
  hardMultiplier: 1.2,
  maxIntervalDays: 365,
  minEase: 1.3,
  leechThreshold: 8,
};

export interface SrsCardState {
  ease_factor: number;
  interval_days: number;
  interval_minutes?: number;
  repetitions: number;
  lapses: number;
  learning_step: number | null;
  status: 'learning' | 'review' | 'mastered' | 'leech';
}

export interface SrsResult extends SrsCardState {
  next_review: Date;
  delta_minutes: number;
  delta_label: string;
  lapsed: boolean;
  in_learning: boolean;
}

const QUALITY: Record<Rating, number> = { again: 0, hard: 3, good: 4, easy: 5 };
export const ratingToQuality = (r: Rating) => QUALITY[r];

export function formatDelta(minutes: number): string {
  if (minutes < 60) return `+${Math.max(1, Math.round(minutes))}m`;
  const days = minutes / 1440;
  if (days < 1) return `+${Math.round(minutes / 60)}h`;
  if (days < 30) return `+${Math.round(days)}d`;
  if (days < 365) return `+${Math.round(days / 30)}mo`;
  return `+${(days / 365).toFixed(1)}y`;
}

const clampInterval = (i: number, s: SrsSettings) => {
  const val = Number.isFinite(i) ? Math.round(i) : 1;
  return Math.min(Math.max(1, val), s.maxIntervalDays);
};

export function applySrs(
  prev: SrsCardState,
  rating: Rating,
  settings: SrsSettings = DEFAULT_SRS_SETTINGS
): SrsResult {
  let { ease_factor, interval_days, repetitions, lapses, learning_step, status } = prev;
  
  // SANITY CHECK: Recover from NaN/Infinity
  if (!Number.isFinite(ease_factor) || ease_factor < settings.minEase) ease_factor = settings.startingEase;
  if (!Number.isFinite(interval_days)) interval_days = 0;
  if (!Number.isFinite(repetitions)) repetitions = 0;
  if (!Number.isFinite(lapses)) lapses = 0;

  let lapsed = false;
  let interval_minutes = 0;

  if (learning_step !== null) {
    if (rating === 'again') {
      learning_step = 0;
      interval_minutes = settings.learningStepsMinutes[0];
      status = 'learning';
    } else if (rating === 'hard') {
      interval_minutes = Math.round(settings.learningStepsMinutes[learning_step] * 1.5);
      status = 'learning';
    } else if (rating === 'good') {
      const next = learning_step + 1;
      if (next >= settings.learningStepsMinutes.length) {
        learning_step = null;
        repetitions = 1;
        interval_days = clampInterval(settings.graduatingIntervalDays, settings);
        status = 'review';
      } else {
        learning_step = next;
        interval_minutes = settings.learningStepsMinutes[next];
      }
    } else if (rating === 'easy') {
      learning_step = null;
      repetitions = 1;
      interval_days = clampInterval(settings.easyIntervalDays, settings);
      status = 'review';
    }
  } else {
    if (rating === 'again') {
      lapses += 1; lapsed = true;
      repetitions = 0;
      learning_step = 0;
      interval_minutes = settings.learningStepsMinutes[0];
      ease_factor = Math.max(settings.minEase, ease_factor - 0.20);
      status = 'learning';
    } else {
      let nextInterval: number;
      if (repetitions === 0)      nextInterval = settings.graduatingIntervalDays;
      else if (repetitions === 1) nextInterval = 6;
      else                        nextInterval = interval_days * ease_factor;

      if (rating === 'hard') {
        nextInterval = Math.max(interval_days * settings.hardMultiplier, interval_days + 1);
      } else if (rating === 'easy') {
        nextInterval = nextInterval * settings.easyBonus;
        ease_factor += 0.15;
      }
      nextInterval = nextInterval * settings.intervalModifier;
      interval_days = clampInterval(nextInterval, settings);
      repetitions += 1;
      status = interval_days >= 90 ? 'mastered' : 'review';
    }
    if (ease_factor < settings.minEase) ease_factor = settings.minEase;
    ease_factor = Math.round(ease_factor * 100) / 100;
  }

  if (lapses >= settings.leechThreshold && interval_days <= 1) status = 'leech';

  const next_review = new Date();
  if (learning_step !== null) next_review.setMinutes(next_review.getMinutes() + interval_minutes);
  else                        next_review.setDate(next_review.getDate() + interval_days);

  const delta_minutes = learning_step !== null ? interval_minutes : interval_days * 1440;

  return {
    ease_factor,
    interval_days: learning_step !== null ? 0 : interval_days,
    interval_minutes: learning_step !== null ? interval_minutes : 0,
    repetitions,
    lapses,
    learning_step,
    status,
    next_review,
    delta_minutes,
    delta_label: formatDelta(delta_minutes),
    lapsed,
    in_learning: learning_step !== null,
  };
}

export function previewAll(state: SrsCardState, settings: SrsSettings = DEFAULT_SRS_SETTINGS) {
  return {
    again: applySrs(state, 'again', settings),
    hard:  applySrs(state, 'hard',  settings),
    good:  applySrs(state, 'good',  settings),
    easy:  applySrs(state, 'easy',  settings),
  };
}

export function nextDueIso(intervalDays: number) {
  const d = new Date(); d.setDate(d.getDate() + Math.max(intervalDays, 0));
  return d.toISOString();
}

export function applySM2(input: { ease_factor:number; interval_days:number; repetitions:number; quality:number }, lapses = 0) {
  const q = Math.max(0, Math.min(5, Math.round(input.quality)));
  const rating: Rating = q < 3 ? 'again' : q === 3 ? 'hard' : q === 4 ? 'good' : 'easy';
  const out = applySrs({
    ease_factor: input.ease_factor, interval_days: input.interval_days,
    repetitions: input.repetitions, lapses,
    learning_step: input.repetitions === 0 ? 0 : null,
    status: input.repetitions === 0 ? 'learning' : 'review',
  }, rating);
  return { ease_factor: out.ease_factor, interval_days: out.interval_days || 1,
           repetitions: out.repetitions, next_review: out.next_review,
           status: out.status, lapsed: out.lapsed };
}
