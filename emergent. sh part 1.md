

you gave this - Perfect, thanks. Here's the **finalized markdown block** for Gemini, now aligned to your architecture choices:

- **Calc**: Client-only (TypeScript)
- **State**: AsyncStorage cache + Supabase source of truth
- **Review history**: Supabase `card_reviews` + AsyncStorage mirror (offline queue)
- **Settings**: Supabase `user_srs_settings` (with tiny local cache for offline reads)
- **Learning steps**: Re-queue in the same session

Paste this whole block to Gemini:

````markdown
# Task: Refactor SRS Engine — Single Source of Truth + Noji-Style UX

**Repo:** `upsc-serv-1/frontend2.2` (master)
**Stack:** React Native (Expo) + Supabase + AsyncStorage

## 0. Architecture Decisions (do not deviate)

1. **Algorithm runs client-side** in pure TypeScript inside `src/services/sm2.ts`. No Postgres/Edge Function math.
2. **Per-card SRS state** (`ease_factor`, `interval_days`, `learning_step`, etc.) is persisted in **Supabase `user_cards` (source of truth)** and **mirrored to AsyncStorage via `FlashcardLocalCache`** (offline-first read, write-through on online).
3. **Review history log** goes to Supabase `card_reviews` AND is mirrored to AsyncStorage as an **offline outbox** that flushes when network returns.
4. **User SRS settings** live in a new Supabase table `user_srs_settings` (synced across devices). A small AsyncStorage cache holds the last-known settings for offline reads.
5. **Learning-step cards re-appear in the same session** by re-queuing them in the in-memory `queue` at the right time slot (not by waiting for the next app open).

---

## 1. Kill the Redundancy

You currently have TWO SM-2 implementations — that is the redundancy.

- **Delete** `src/lib/sm2.ts`
- **Move/keep** the canonical implementation at `src/services/sm2.ts` (rewritten in §2)
- Project-wide search & replace import paths:
  ```
  from '../../src/lib/sm2'  →  from '../../src/services/sm2'
  from 'src/lib/sm2'        →  from 'src/services/sm2'
  from '@/src/lib/sm2'      →  from '@/src/services/sm2'
  ```
- Likely consumers to verify after replace:
  - `src/services/FlashcardService.ts`
  - `src/services/FlashcardLocalCache.ts` (`reviewCardSafe`)
  - `app/flashcards/review.tsx`
  - any `scratch/*` or `check_*.ts` scripts (low priority — fix only if they break TS build)
- Re-export `nextDueIso` from the new file so nothing breaks.

---

## 2. Rewrite `src/services/sm2.ts` (Pure Client-Side Engine)

Replace the **entire file** with this. Pure functions only, no I/O, no async, no Supabase imports.

```ts
// src/services/sm2.ts
// CLIENT-SIDE Spaced Repetition engine. Pure functions. Single source of truth.

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface SrsSettings {
  learningStepsMinutes: number[];   // default [1, 10]
  graduatingIntervalDays: number;   // default 1
  easyIntervalDays: number;         // default 4
  startingEase: number;             // default 2.50
  easyBonus: number;                // default 1.30
  intervalModifier: number;         // default 1.00 (deck difficulty)
  hardMultiplier: number;           // default 1.20
  maxIntervalDays: number;          // default 365
  minEase: number;                  // default 1.30
  leechThreshold: number;           // default 8 lapses
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
  learning_step: number | null;     // null = graduated to review
  status: 'learning' | 'review' | 'mastered' | 'leech';
}

export interface SrsResult extends SrsCardState {
  next_review: Date;
  delta_minutes: number;            // for in-session requeue + button labels
  delta_label: string;              // "+1m", "+10m", "+4d"
  lapsed: boolean;
  in_learning: boolean;             // true → requeue in current session
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

const clampInterval = (i: number, s: SrsSettings) =>
  Math.min(Math.max(1, Math.round(i)), s.maxIntervalDays);

export function applySrs(
  prev: SrsCardState,
  rating: Rating,
  settings: SrsSettings = DEFAULT_SRS_SETTINGS
): SrsResult {
  let { ease_factor, interval_days, repetitions, lapses, learning_step, status } = prev;
  if (!ease_factor || ease_factor < settings.minEase) ease_factor = settings.startingEase;

  let lapsed = false;
  let interval_minutes = 0;

  // ---------- LEARNING / RELEARNING ----------
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
  }
  // ---------- REVIEW ----------
  else {
    if (rating === 'again') {
      lapses += 1; lapsed = true;
      repetitions = 0;
      learning_step = 0;
      interval_minutes = settings.learningStepsMinutes[0];
      ease_factor = Math.max(settings.minEase, ease_factor - 0.20); // fixed lapse penalty, NO compounding decay
      status = 'learning';
    } else {
      let nextInterval: number;
      if (repetitions === 0)      nextInterval = settings.graduatingIntervalDays; // 1
      else if (repetitions === 1) nextInterval = 6;                                 // strict SM-2
      else                        nextInterval = interval_days * ease_factor;

      if (rating === 'hard') {
        // PASSING grade. Smaller jump. NO EF decay.
        nextInterval = Math.max(interval_days * settings.hardMultiplier, interval_days + 1);
      } else if (rating === 'easy') {
        nextInterval = nextInterval * settings.easyBonus;
        ease_factor += 0.15;
      }
      // 'good' leaves EF untouched

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

// Used by review screen to label the 4 buttons before the user taps
export function previewAll(state: SrsCardState, settings: SrsSettings = DEFAULT_SRS_SETTINGS) {
  return {
    again: applySrs(state, 'again', settings),
    hard:  applySrs(state, 'hard',  settings),
    good:  applySrs(state, 'good',  settings),
    easy:  applySrs(state, 'easy',  settings),
  };
}

// Backward-compat shims (delete after migration is verified)
export function nextDueIso(intervalDays: number) {
  const d = new Date(); d.setDate(d.getDate() + Math.max(intervalDays, 0));
  return d.toISOString();
}
export function applySM2(input: { ease_factor:number; interval_days:number; repetitions:number; quality:number }, lapses = 0) {
  const q = Math.max(0, Math.min(5, Math.round(input.quality)));
  const rating: Rating = q < 3 ? 'again' : q === 3 ? 'hard' : q === 4 ? 'good' : 'easy';
  const out = applySrs({
    ease_factor: input.ease_factor,
    interval_days: input.interval_days,
    repetitions: input.repetitions,
    lapses,
    learning_step: input.repetitions === 0 ? 0 : null,
    status: input.repetitions === 0 ? 'learning' : 'review',
  }, rating);
  return {
    ease_factor: out.ease_factor,
    interval_days: out.interval_days || 1,
    repetitions: out.repetitions,
    next_review: out.next_review,
    status: out.status,
    lapsed: out.lapsed,
  };
}
```

---

## 3. Supabase Migrations

Create `supabase/migration-srs-v5.sql`:

```sql
-- Per-card SRS state additions (source of truth)
ALTER TABLE public.user_cards
  ADD COLUMN IF NOT EXISTS learning_step    smallint,
  ADD COLUMN IF NOT EXISTS interval_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lapses           integer DEFAULT 0;

-- Per-user SRS settings
CREATE TABLE IF NOT EXISTS public.user_srs_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  learning_steps_minutes int[] NOT NULL DEFAULT '{1,10}',
  graduating_interval_days int NOT NULL DEFAULT 1,
  easy_interval_days int NOT NULL DEFAULT 4,
  starting_ease numeric(4,2) NOT NULL DEFAULT 2.50,
  easy_bonus numeric(4,2) NOT NULL DEFAULT 1.30,
  interval_modifier numeric(4,2) NOT NULL DEFAULT 1.00,
  hard_multiplier numeric(4,2) NOT NULL DEFAULT 1.20,
  max_interval_days int NOT NULL DEFAULT 365,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.user_srs_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_srs_settings_self_rw" ON public.user_srs_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

> The existing `card_reviews` log table stays as-is. Just keep writing `rating`/`quality`, `prev_*`, `new_*`, and now also `learning_step` (add column if it doesn't exist).

```sql
ALTER TABLE public.card_reviews
  ADD COLUMN IF NOT EXISTS learning_step smallint,
  ADD COLUMN IF NOT EXISTS rating text;  -- 'again'|'hard'|'good'|'easy'
```

---

## 4. Settings Service (Supabase + tiny local cache)

Create `src/services/SrsSettingsService.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { DEFAULT_SRS_SETTINGS, SrsSettings } from './sm2';

const KEY = (uid: string) => `srs_settings_${uid}`;

export const SrsSettingsSvc = {
  async load(userId: string): Promise<SrsSettings> {
    // 1. cache first (offline-friendly)
    const cached = await AsyncStorage.getItem(KEY(userId));
    if (cached) {
      try { return { ...DEFAULT_SRS_SETTINGS, ...JSON.parse(cached) }; } catch {}
    }
    // 2. supabase
    const { data } = await supabase
      .from('user_srs_settings').select('*').eq('user_id', userId).maybeSingle();
    if (!data) return DEFAULT_SRS_SETTINGS;
    const s: SrsSettings = {
      learningStepsMinutes: data.learning_steps_minutes ?? [1, 10],
      graduatingIntervalDays: data.graduating_interval_days,
      easyIntervalDays: data.easy_interval_days,
      startingEase: Number(data.starting_ease),
      easyBonus: Number(data.easy_bonus),
      intervalModifier: Number(data.interval_modifier),
      hardMultiplier: Number(data.hard_multiplier),
      maxIntervalDays: data.max_interval_days,
      minEase: DEFAULT_SRS_SETTINGS.minEase,
      leechThreshold: DEFAULT_SRS_SETTINGS.leechThreshold,
    };
    await AsyncStorage.setItem(KEY(userId), JSON.stringify(s));
    return s;
  },

  async save(userId: string, s: SrsSettings) {
    await AsyncStorage.setItem(KEY(userId), JSON.stringify(s));
    await supabase.from('user_srs_settings').upsert({
      user_id: userId,
      learning_steps_minutes: s.learningStepsMinutes,
      graduating_interval_days: s.graduatingIntervalDays,
      easy_interval_days: s.easyIntervalDays,
      starting_ease: s.startingEase,
      easy_bonus: s.easyBonus,
      interval_modifier: s.intervalModifier,
      hard_multiplier: s.hardMultiplier,
      max_interval_days: s.maxIntervalDays,
      updated_at: new Date().toISOString(),
    });
  },
};
```

---

## 5. Update `FlashcardLocalCache.reviewCardSafe`

Change the contract to **rating-based** + write-through to Supabase + offline outbox for the review log.

```ts
// Pseudocode of the rewritten reviewCardSafe
async reviewCardSafe(userId: string, cardId: string, rating: Rating): Promise<SrsResult> {
  // 1. Load current state (cache → fallback to supabase)
  const cached = await this._loadCardState(userId, cardId);
  const settings = await SrsSettingsSvc.load(userId);

  // 2. Compute on device
  const result = applySrs(cached, rating, settings);

  // 3. Write-through: AsyncStorage immediately
  await this._saveCardState(userId, cardId, result);

  // 4. Queue review log entry to AsyncStorage outbox
  await this._enqueueReviewLog({
    user_id: userId,
    card_id: cardId,
    rating,
    quality: ratingToQuality(rating),
    prev_ef: cached.ease_factor,
    new_ef: result.ease_factor,
    prev_interval: cached.interval_days,
    new_interval: result.interval_days,
    learning_step: result.learning_step,
    reviewed_at: new Date().toISOString(),
  });

  // 5. Best-effort upsert to Supabase user_cards (don't await failures)
  supabase.from('user_cards').upsert({
    user_id: userId,
    card_id: cardId,
    ease_factor: result.ease_factor,
    interval_days: result.interval_days,
    interval_minutes: result.interval_minutes,
    repetitions: result.repetitions,
    lapses: result.lapses,
    learning_step: result.learning_step,
    status: result.status,
    next_review: result.next_review.toISOString(),
    last_reviewed: new Date().toISOString(),
  }, { onConflict: 'user_id,card_id' }).then(() => this._flushOutbox(userId));

  // 6. Kick the outbox flusher in background (NetInfo + interval)
  this._flushOutbox(userId).catch(() => {});

  return result;
}
```

Add an outbox flush method that drains the queued `card_reviews` rows to Supabase whenever online (use `@react-native-community/netinfo` if not already installed; otherwise just retry on next review).

---

## 6. Review Screen — In-Session Re-Queue + Dynamic Buttons

Edit `app/flashcards/review.tsx`:

### 6.1 Replace 5-button row with 4 rating buttons + dynamic deltas

```tsx
import { applySrs, previewAll, Rating, SrsCardState, SrsSettings, DEFAULT_SRS_SETTINGS } from '../../src/services/sm2';
import { SrsSettingsSvc } from '../../src/services/SrsSettingsService';

const [settings, setSettings] = useState<SrsSettings>(DEFAULT_SRS_SETTINGS);
useEffect(() => { if (session?.user.id) SrsSettingsSvc.load(session.user.id).then(setSettings); }, [session]);

const cardState: SrsCardState = useMemo(() => {
  const s = currentCard?.state ?? {};
  return {
    ease_factor: s.ease_factor ?? settings.startingEase,
    interval_days: s.interval_days ?? 0,
    repetitions: s.repetitions ?? 0,
    lapses: s.lapses ?? 0,
    learning_step: s.learning_step ?? (s.repetitions ? null : 0),
    status: s.status ?? 'learning',
  };
}, [currentCard, settings]);

const preview = useMemo(
  () => (isFlipped ? previewAll(cardState, settings) : null),
  [isFlipped, cardState, settings]
);

const BUTTONS: { rating: Rating; label: string; color: string }[] = [
  { rating: 'again', label: 'Again', color: '#ef4444' },
  { rating: 'hard',  label: 'Hard',  color: '#f59e0b' },
  { rating: 'good',  label: 'Good',  color: colors.primary },
  { rating: 'easy',  label: 'Easy',  color: '#3b82f6' },
];

// JSX
{BUTTONS.map(({ rating, label, color }) => (
  <TouchableOpacity
    key={rating}
    onPress={() => rate(rating)}
    style={[styles.qBtn, { borderColor: color }]}
    testID={`review-btn-${rating}`}
  >
    <Text style={[styles.qBtnLabel, { color }]}>{label}</Text>
    <Text style={styles.qBtnSub}>{preview?.[rating].delta_label ?? ''}</Text>
  </TouchableOpacity>
))}
```

### 6.2 In-session re-queue for learning-step cards

Track due-times for cards that are still in learning steps:

```tsx
type QueueEntry = { card: any; readyAt: number };  // ms epoch

const [queue, setQueue] = useState<QueueEntry[]>([]);

const rate = async (rating: Rating) => {
  const entry = queue[currentIndex];
  if (!entry || !session?.user.id) return;

  const result = await FlashcardLocalCache.reviewCardSafe(session.user.id, entry.card.id, rating);
  setNextDueLabel(result.delta_label);

  // Update card.state in memory so previews on next render reflect new state
  entry.card.state = {
    ...(entry.card.state || {}),
    ease_factor: result.ease_factor,
    interval_days: result.interval_days,
    interval_minutes: result.interval_minutes,
    repetitions: result.repetitions,
    lapses: result.lapses,
    learning_step: result.learning_step,
    status: result.status,
    next_review: result.next_review.toISOString(),
  };

  // Build the new queue
  const remaining = queue.filter((_, i) => i !== currentIndex);

  if (result.in_learning) {
    // Re-queue this card in the current session at readyAt = now + delta_minutes
    const readyAt = Date.now() + result.delta_minutes * 60_000;
    remaining.push({ card: entry.card, readyAt });
  }

  // Sort: cards whose readyAt has passed first, then by readyAt ascending.
  // If nothing is ready yet, surface the soonest one (don't block the user).
  const now = Date.now();
  remaining.sort((a, b) => a.readyAt - b.readyAt);

  setQueue(remaining);
  setCurrentIndex(0);
  setIsFlipped(false);
  setShowCorrect(false);
  flipAnim.setValue(0);

  if (remaining.length === 0) {
    Alert.alert('Session Complete', "You've finished all cards.", [
      { text: 'Done', onPress: () => router.back() },
    ]);
  }
};
```

When loading the initial queue, wrap each card as `{ card, readyAt: 0 }` so they're all immediately due.

### 6.3 Drop the "Perfect" button (it was duplicating Easy)

---

## 7. New Settings Screen `app/flashcards/settings.tsx`

A simple form:

- Learning Steps (CSV minutes, default `1, 10`)
- Graduating Interval (days, default `1`)
- Easy Interval (days, default `4`)
- Starting Ease (default `2.50`)
- Easy Bonus % (default `130`)
- Interval Modifier % (default `100`) ← deck difficulty slider
- Hard Multiplier (default `1.20`)
- Max Interval (days, default `365`)

Save button → `SrsSettingsSvc.save(userId, settings)`. Reset to Defaults button. Use `PageWrapper` + `useTheme().colors`. Every input gets a `testID`.

Add an entry-point icon from `app/flashcards.tsx` header → `router.push('/flashcards/settings')`.

---

## 8. Acceptance Tests (write in `scratch/test_srs.ts`)

```ts
import { applySrs, DEFAULT_SRS_SETTINGS } from '../src/services/sm2';
const fresh = { ease_factor:2.5, interval_days:0, repetitions:0, lapses:0, learning_step:0, status:'learning' as const };

// 1. Again on new card → +1m, EF unchanged
console.assert(applySrs(fresh,'again').delta_label === '+1m');
console.assert(applySrs(fresh,'again').ease_factor === 2.5);

// 2. Good twice on new card → graduates to +1d
const afterGood = applySrs(fresh,'good');
console.assert(afterGood.delta_label === '+10m');
const graduated = applySrs(afterGood,'good');
console.assert(graduated.delta_label === '+1d' && graduated.learning_step === null);

// 3. Strict SM-2 jump n=1 → 6d
const r1 = { ...graduated };
const r2 = applySrs(r1,'good');
console.assert(r2.interval_days === 6);

// 4. Hard does NOT decay EF and does NOT reset
const big = { ease_factor:2.5, interval_days:30, repetitions:5, lapses:0, learning_step:null, status:'review' as const };
const hard = applySrs(big,'hard');
console.assert(hard.ease_factor === 2.5 && hard.interval_days >= 31);

// 5. Again on a mature card → fixed 0.20 EF drop, drops to learning
const lapse = applySrs(big,'again');
console.assert(Math.abs(lapse.ease_factor - 2.30) < 0.001 && lapse.in_learning);

// 6. Max interval cap
const huge = { ease_factor:3.0, interval_days:400, repetitions:20, lapses:0, learning_step:null, status:'review' as const };
console.assert(applySrs(huge,'easy').interval_days === 365);
```

---

## 9. Cleanup Checklist

- [ ] `src/lib/sm2.ts` deleted
- [ ] All imports repointed to `src/services/sm2`
- [ ] No code references raw `quality 0|2|3|4|5` (`q: 2`, `q: 5`, etc.) — all rating-based
- [ ] `user_cards` and `card_reviews` migrations applied
- [ ] `user_srs_settings` table + RLS policy created
- [ ] `SrsSettingsService` reads settings cache-first, writes through
- [ ] `FlashcardLocalCache.reviewCardSafe` is rating-based + writes outbox + upserts Supabase
- [ ] Review screen shows 4 buttons with dynamic `+1m / +10m / +4d` labels
- [ ] Learning-step cards re-queue in same session
- [ ] Settings screen reachable & saves to Supabase
- [ ] Hard never resets a card; EF never drops on Good/Hard/Easy

## 10. Why this matches the user's choices

- **Client-only calc** → engine is pure TS in `src/services/sm2.ts`, no SQL/RPC math.
- **Cache + Supabase truth** → `FlashcardLocalCache` writes locally first, upserts `user_cards` after.
- **History to Supabase + AsyncStorage outbox** → offline reviews never lost, flushed on reconnect.
- **Settings in Supabase** → cross-device, with a small AsyncStorage cache for cold-start/offline reads.
- **In-session re-queue** → the `queue` array carries `readyAt` timestamps; learning-step cards bubble back up exactly when their `+1m` / `+10m` elapses.
````

If anything in your `FlashcardLocalCache.ts` or `card_reviews` schema differs from what I assumed, share that file and I'll adjust this block precisely.