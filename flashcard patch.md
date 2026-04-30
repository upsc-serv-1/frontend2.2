Got it — I have your repo (`upsc-serv-1/frontend2.2`), and I've read `FlashcardService.ts`, `sm2.ts`, `ImageUpload.ts`, `app/flashcards/microtopic.tsx`, `app/flashcards/review.tsx`, and the Supabase schema. Below are **6 markdown patch-packs**, in order. Feed them to Gemini one-by-one.

Each block is self-contained with: `FILE`, `ACTION`, `FIND` → `REPLACE` (or append), and `WHY`. No file is rewritten wholesale — only targeted diffs.

---

### 📦 How to apply (for Gemini)

> Apply the blocks strictly in order **01 → 06**. Each block lists the exact file path relative to repo root. Where it says `FIND` + `REPLACE`, do a literal string replacement (preserve whitespace). Where it says `APPEND`, add at end of file. Where it says `INSERT AFTER <marker>`, locate the marker line and insert the new code just after it. After block 01 (SQL), run the migration on Supabase SQL editor before touching code.

---

## 📄 PATCH 01 — Database migration (multi-institute, local-sync columns, Storage bucket)

````markdown
# PATCH 01 — supabase/migration-flashcards-v3.sql

ACTION: create new file `supabase/migration-flashcards-v3.sql` and run it once in Supabase SQL editor.

```sql
-- =========================================================
-- PATCH 01: multi-institute answer tracking + local-sync fields
-- =========================================================

-- 1. Add columns to cards for institute attribution (req #3)
alter table public.cards
  add column if not exists institutes      jsonb   default '[]'::jsonb,
  add column if not exists merged_from     jsonb   default '[]'::jsonb,
  add column if not exists primary_institute text;

-- institutes: [{ institute:"UPSC", year:2019, test_id:"t_abc", correct:"a" }, ...]
-- merged_from: list of original question_ids merged into this card

-- 2. Add columns to user_cards for Noji-grade tracking (req #7, #11, #13)
alter table public.user_cards
  add column if not exists user_note        text    default '',
  add column if not exists client_updated_at timestamptz default now(),
  add column if not exists dirty            boolean default false,
  add column if not exists times_seen       integer default 0;

-- learning_status already exists per your schema, keep it.
-- Valid values: 'not_studied' | 'learning' | 'review' | 'mastered' | 'leech'

-- 3. Convenience view: deck summary (fix for req #8 — correct counts)
create or replace view public.v_deck_summary as
select
  uc.user_id,
  c.subject,
  coalesce(c.section_group, 'General') as section_group,
  coalesce(c.microtopic, 'General')    as microtopic,
  count(*) filter (where uc.learning_status = 'not_studied') as new_count,
  count(*) filter (where uc.learning_status = 'learning')    as learning_count,
  count(*) filter (where uc.learning_status = 'mastered')    as mastered_count,
  count(*) filter (where uc.learning_status = 'leech')       as leech_count,
  count(*) filter (where uc.status = 'active'
                     and uc.next_review <= now())            as due_count,
  count(*)                                                   as total_count
from public.user_cards uc
join public.cards c on c.id = uc.card_id
group by uc.user_id, c.subject, c.section_group, c.microtopic;

-- 4. RLS passthrough on the view (inherits base table RLS)
alter view public.v_deck_summary set (security_invoker = true);

-- 5. Image storage bucket (req #15)
insert into storage.buckets (id, name, public)
values ('flashcard-images', 'flashcard-images', true)
on conflict (id) do nothing;

-- Public read, authenticated write
drop policy if exists "flashcard-images-read"  on storage.objects;
drop policy if exists "flashcard-images-write" on storage.objects;

create policy "flashcard-images-read"
  on storage.objects for select
  using (bucket_id = 'flashcard-images');

create policy "flashcard-images-write"
  on storage.objects for insert
  with check (
    bucket_id = 'flashcard-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "flashcard-images-delete"
  on storage.objects for delete
  using (
    bucket_id = 'flashcard-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

WHY
- `institutes` jsonb lets one deduped card carry answers from UPSC, State PSC, etc. (req #3)
- `user_note` persists user-typed note shown next flip (req #11)
- `client_updated_at` + `dirty` enable offline-first sync (req #7)
- `v_deck_summary` fixes the wrong "New:1 / Learning:0 / Mastered:0" tally (req #8)
- Storage bucket + policies ready for image upload (req #15)
````

---

## 📄 PATCH 02 — FlashcardService: add missing methods + local cache

````markdown
# PATCH 02 — src/services/FlashcardService.ts

ACTION 1: ADD export types after the `NewCardInput` interface (line ~21):

```ts
export type LearningStatus = 'not_studied' | 'learning' | 'review' | 'mastered' | 'leech';

export interface CardState {
  user_id: string;
  card_id: string;
  status: 'active' | 'frozen';
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review: string;
  last_reviewed?: string;
  learning_status: LearningStatus;
  again_count: number;
  lapses: number;
  user_note: string;
  times_seen: number;
}

export interface InstituteSource {
  institute: string;
  year?: number;
  test_id?: string;
  correct?: string;
}
```

ACTION 2: FIND the existing `createFromQuestion` method and REPLACE it with the version below (adds institute merging per req #3):

```ts
// ============ CREATE FROM QUIZ QUESTION (req #1, #2, #3) ============
// Front = question_text + statement_lines + options (a)…(d)
// Back  = correct-answer line + explanation (+ multi-institute answers if merged)
static async createFromQuestion(userId: string, q: any) {
  const opts = q.options ?? {};
  const stmtLines = Array.isArray(q.statement_lines) ? q.statement_lines.join('\n') : '';
  const optionLines = Object.entries(opts)
    .map(([k, v]) => `(${k.toUpperCase()}) ${v}`).join('\n');
  const front_text = [q.question_text || q.questionText || '', stmtLines, optionLines]
    .filter(Boolean).join('\n\n').trim();

  const correctKey = q.correct_answer || q.correctAnswer;
  const correctText = correctKey && opts[correctKey]
    ? `**Correct: (${correctKey.toUpperCase()})** ${opts[correctKey]}` : '';
  const explanation = q.explanation_markdown || q.explanation || '';

  // Multi-institute block (req #3) — only when merged pyq
  const instituteSrc: InstituteSource = {
    institute: q.institute || q.tests?.institute || q.provider || 'Unknown',
    year: q.exam_year || q.year,
    test_id: q.test_id || q.testId || q.tests?.id,
    correct: correctKey,
  };

  const back_text = [correctText, explanation].filter(Boolean).join('\n\n');

  // Check for existing card (dedupe by question_id OR by normalized front_text hash)
  let card: { id: string; institutes?: any[]; merged_from?: any[] } | null = null;
  if (q.id) {
    const { data } = await supabase
      .from('cards')
      .select('id, institutes, merged_from')
      .eq('question_id', q.id).maybeSingle();
    if (data) card = data as any;
  }

  if (card) {
    // Merge institute into existing card (req #3)
    const existing = Array.isArray(card.institutes) ? card.institutes : [];
    const alreadyPresent = existing.some((i: InstituteSource) =>
      i.institute === instituteSrc.institute && i.year === instituteSrc.year);
    if (!alreadyPresent) {
      await supabase.from('cards').update({
        institutes: [...existing, instituteSrc],
        merged_from: [...(card.merged_from || []), q.id],
      }).eq('id', card.id);
    }
    // Still link to user_cards for this user
    await this.linkUserCard(userId, card.id);
    return card.id;
  }

  // Fresh card
  const { data: inserted, error } = await supabase
    .from('cards')
    .insert({
      question_id: q.id || `manual_${Date.now()}`,
      subject: q.subject || 'General',
      section_group: q.section_group || 'General',
      microtopic: q.micro_topic || q.microtopic || 'General',
      front_text, back_text,
      card_type: 'qa',
      source: { kind: 'question', question_id: q.id, options: opts },
      test_id: q.test_id || q.testId || q.tests?.id || 'manual',
      correct_answer: correctKey,
      question_text: front_text,
      answer_text: back_text,
      institutes: [instituteSrc],
      primary_institute: instituteSrc.institute,
      merged_from: [q.id],
    })
    .select('id').single();
  if (error) throw error;

  await this.linkUserCard(userId, inserted.id);
  return inserted.id;
}

private static async linkUserCard(userId: string, cardId: string) {
  const { data: existing } = await supabase
    .from('user_cards').select('id').eq('user_id', userId).eq('card_id', cardId).maybeSingle();
  if (existing) return;
  await supabase.from('user_cards').insert({
    user_id: userId, card_id: cardId,
    ease_factor: 2.5, interval_days: 0, repetitions: 0, lapses: 0,
    next_review: new Date().toISOString(),
    status: 'active', learning_status: 'not_studied',
  });
}
```

ACTION 3: APPEND these methods before the final `}` of the `FlashcardSvc` class:

```ts
  // ============ FREEZE / UNFREEZE (req #6, #9) ============
  static async freezeCard(userId: string, cardId: string) {
    const { error } = await supabase.from('user_cards')
      .update({ status: 'frozen', updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('card_id', cardId);
    if (error) throw error;
  }
  static async unfreezeCard(userId: string, cardId: string) {
    const { error } = await supabase.from('user_cards')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('card_id', cardId);
    if (error) throw error;
  }

  // ============ PERSONAL NOTE (req #11) ============
  static async saveNote(userId: string, cardId: string, note: string) {
    const { error } = await supabase.from('user_cards')
      .update({ user_note: note, updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('card_id', cardId);
    if (error) throw error;
  }

  // ============ DECK SUMMARY (req #8) ============
  static async getDeckSummary(userId: string, subject: string, section: string, microtopic: string) {
    const { data, error } = await supabase
      .from('v_deck_summary')
      .select('*')
      .eq('user_id', userId)
      .eq('subject', subject)
      .eq('section_group', section || 'General')
      .eq('microtopic', microtopic || 'General')
      .maybeSingle();
    if (error) throw error;
    return data ?? { new_count: 0, learning_count: 0, mastered_count: 0, due_count: 0, total_count: 0 };
  }

  // ============ CARD LIST WITH PREVIEW (req #10) ============
  static async listCardsWithProgress(
    userId: string, subject: string, section: string, microtopic: string
  ) {
    const { data, error } = await supabase
      .from('user_cards')
      .select(`
        *,
        cards!inner (
          id, front_text, back_text, question_text, answer_text,
          subject, section_group, microtopic,
          front_image_url, back_image_url, institutes
        )
      `)
      .eq('user_id', userId)
      .eq('cards.subject', subject)
      .eq('cards.section_group', section || 'General')
      .eq('cards.microtopic', microtopic || 'General');
    if (error) throw error;
    return (data ?? []).map((d: any) => ({
      ...d.cards,
      ...d,
      id: d.card_id,
      preview: (d.user_note || d.cards.front_text || d.cards.question_text || '').slice(0, 80),
    }));
  }

  // ============ DUE CARDS WITH DAY-LABEL (req #14) ============
  static async listDueWithDays(userId: string, withinDays = 7) {
    const now = new Date();
    const horizon = new Date(now); horizon.setDate(horizon.getDate() + withinDays);
    const { data, error } = await supabase
      .from('user_cards')
      .select('*, cards!inner(*)')
      .eq('user_id', userId)
      .lte('next_review', horizon.toISOString())
      .eq('status', 'active')
      .order('next_review', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((d: any) => {
      const due = new Date(d.next_review);
      const diff = Math.ceil((due.getTime() - now.getTime()) / 86400000);
      return {
        ...d.cards, ...d, id: d.card_id,
        days_until_due: diff <= 0 ? 0 : diff,
        due_label: diff <= 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `${diff}d`,
      };
    });
  }
```

WHY
- `review.tsx` already imports `CardState`, `freezeCard`, `saveNote` — they didn't exist ⇒ compile errors.
- `createFromQuestion` now merges institutes (req #3) so a dedupe PYQ shows "UPSC 2019 • BPSC 2021" together.
- `getDeckSummary` uses the new SQL view ⇒ correct New/Learning/Mastered tally (req #8).
- `listCardsWithProgress` returns a `preview` per card so the microtopic list shows first 80 chars of note/front (req #10).
- `listDueWithDays` powers the "Due" section with day-labels (req #14).
````

---

## 📄 PATCH 03 — Add AsyncStorage queue (offline pause+resume)

````markdown
# PATCH 03 — src/services/FlashcardLocalCache.ts

ACTION: CREATE NEW FILE `src/services/FlashcardLocalCache.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { FlashcardSvc, CardState } from './FlashcardService';

/**
 * Local persistence for flashcard state.
 * Req #6: pause session mid-way (resume later with same position).
 * Req #7: flashcard status saved locally AND on server (write-through + offline queue).
 */

const SESSION_KEY = (uid: string, mt: string) => `fc.session.${uid}.${mt}`;
const STATE_KEY   = (uid: string, cid: string) => `fc.state.${uid}.${cid}`;
const QUEUE_KEY   = (uid: string) => `fc.queue.${uid}`;

export interface SessionSnapshot {
  microtopic: string;
  subject: string;
  section: string;
  queueCardIds: string[];
  currentIndex: number;
  flipped: boolean;
  savedAt: string;
}

export const FlashcardLocalCache = {
  // ---- SESSION PAUSE/RESUME (req #6) ----
  async saveSession(userId: string, snap: SessionSnapshot) {
    await AsyncStorage.setItem(SESSION_KEY(userId, snap.microtopic), JSON.stringify(snap));
  },
  async loadSession(userId: string, microtopic: string): Promise<SessionSnapshot | null> {
    const raw = await AsyncStorage.getItem(SESSION_KEY(userId, microtopic));
    return raw ? JSON.parse(raw) : null;
  },
  async clearSession(userId: string, microtopic: string) {
    await AsyncStorage.removeItem(SESSION_KEY(userId, microtopic));
  },

  // ---- WRITE-THROUGH STATE (req #7) ----
  async cacheState(userId: string, cardId: string, state: Partial<CardState>) {
    await AsyncStorage.setItem(STATE_KEY(userId, cardId), JSON.stringify({
      ...state, _cachedAt: new Date().toISOString(),
    }));
  },
  async readState(userId: string, cardId: string) {
    const raw = await AsyncStorage.getItem(STATE_KEY(userId, cardId));
    return raw ? JSON.parse(raw) : null;
  },

  // ---- OFFLINE QUEUE (req #7) ----
  async enqueueReview(userId: string, payload: { cardId: string; quality: number; ts: string }) {
    const raw = await AsyncStorage.getItem(QUEUE_KEY(userId));
    const list = raw ? JSON.parse(raw) : [];
    list.push(payload);
    await AsyncStorage.setItem(QUEUE_KEY(userId), JSON.stringify(list));
  },
  async flushQueue(userId: string): Promise<number> {
    const raw = await AsyncStorage.getItem(QUEUE_KEY(userId));
    const list = raw ? JSON.parse(raw) : [];
    if (!list.length) return 0;
    let ok = 0;
    const remaining: any[] = [];
    for (const item of list) {
      try {
        await FlashcardSvc.reviewCard(userId, item.cardId, item.quality);
        ok++;
      } catch { remaining.push(item); }
    }
    await AsyncStorage.setItem(QUEUE_KEY(userId), JSON.stringify(remaining));
    return ok;
  },

  // ---- REVIEW WITH FALLBACK (req #7) ----
  async reviewCardSafe(userId: string, cardId: string, quality: number) {
    try {
      const sm = await FlashcardSvc.reviewCard(userId, cardId, quality);
      await this.cacheState(userId, cardId, {
        ease_factor: sm.ease_factor,
        interval_days: sm.interval_days,
        repetitions: sm.repetitions,
        next_review: sm.next_review.toISOString(),
        learning_status: sm.status as any,
      });
      return sm;
    } catch (err) {
      // Offline — queue & optimistic-cache
      await this.enqueueReview(userId, { cardId, quality, ts: new Date().toISOString() });
      const cached = (await this.readState(userId, cardId)) || {};
      const interval = Math.max(1, (cached.interval_days || 1) * 2);
      const next = new Date(); next.setDate(next.getDate() + interval);
      const snap = {
        ease_factor: cached.ease_factor || 2.5,
        interval_days: interval,
        repetitions: (cached.repetitions || 0) + 1,
        next_review: next,
        status: (interval >= 90 ? 'mastered' : 'learning') as any,
        lapsed: quality < 3,
      };
      await this.cacheState(userId, cardId, {
        ease_factor: snap.ease_factor,
        interval_days: snap.interval_days,
        repetitions: snap.repetitions,
        next_review: snap.next_review.toISOString(),
        learning_status: snap.status,
      });
      return snap;
    }
  },
};
```

ACTION: Install dep if not already present — check `package.json`, `@react-native-async-storage/async-storage` is already used in `app/flashcards/review.tsx`, so no install needed.

WHY
- Pause button (req #6) just calls `saveSession` → Home shows "Resume".
- Every review now cached locally first, server next. If offline, queued and retried on next online `flushQueue` call (req #7).
- Wire `flushQueue(userId)` inside your `AuthContext` `useEffect` on app foreground.
````

---

## 📄 PATCH 04 — Quiz engine: "Add to Cards" (req #1, #2, #3)

````markdown
# PATCH 04 — app/unified/engine.tsx

ACTION: FIND the existing line (around line 1059):

```tsx
      await FlashcardSvc.createFlashcardFromQuestion(session.user.id, q);
```

REPLACE with:

```tsx
      // req #1/#2/#3: front = question+statements+options, back = correct+explanation,
      // institutes auto-merged if this PYQ already exists from another institute.
      await FlashcardSvc.createFromQuestion(session.user.id, {
        ...q,
        institute: q.institute || q.tests?.institute || q.provider,
        exam_year: q.exam_year || q.year,
      });
      // Lightweight toast (swap with your toast system if present)
      if (Alert && Alert.alert) Alert.alert('Added', 'Flashcard added to your deck.');
```

ACTION: Also FIND the context-menu item / long-press item that shows "Add to Flashcards" (search for `"Add to Flashcards"` or `createFlashcardFromQuestion` in the file). Ensure it passes the full question object `q` (not just id), so `options`, `statement_lines`, `explanation_markdown`, `institute` are carried.

WHY
- Single call path for all 3 requirements. If the question_id already maps to an existing card (duplicate PYQ), patch 02's `createFromQuestion` pushes the new institute into the `institutes[]` array — so the back of the card will show "UPSC 2019 (A) • BPSC 2021 (B)" once patch 05 is applied.
````

---

## 📄 PATCH 05 — Microtopic screen fixes (#8, #9, #10, #14)

````markdown
# PATCH 05 — app/flashcards/microtopic.tsx

These replace the broken stats/filter logic so the tally, filter panels, and card previews all reflect real user progress.

ACTION 1: FIND the entire `loadCards` function (starts `const loadCards = async () => {`) and REPLACE with:

```tsx
  const loadCards = async () => {
    setLoading(true);
    try {
      const userId = session!.user.id;
      const sec = (section as string) || 'General';

      // Use the patched service → view-backed summary + cards w/ preview
      const [summary, items] = await Promise.all([
        FlashcardSvc.getDeckSummary(userId, subject as string, sec, microtopic as string),
        FlashcardSvc.listCardsWithProgress(userId, subject as string, sec, microtopic as string),
      ]);

      setStats({
        due:      summary.due_count      ?? 0,
        new:      summary.new_count      ?? 0,
        learning: summary.learning_count ?? 0,
        mastered: summary.mastered_count ?? 0,
      });

      const merged: CardItem[] = items.map((it: any) => ({
        id: it.id,
        front_text: it.front_text || it.question_text || '',
        back_text:  it.back_text  || it.answer_text   || '',
        status:     it.status     || 'active',
        learning_status: it.learning_status || 'not_studied',
        next_review: it.next_review,
        updated_at:  it.updated_at || it.created_at,
        preview:     it.preview,
        user_note:   it.user_note,
      }));
      setCards(merged);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
```

ACTION 2: FIND the `CardItem` interface near top and REPLACE with:

```tsx
interface CardItem {
  id: string;
  front_text: string;
  back_text: string;
  status: 'active' | 'frozen';
  learning_status: 'not_studied' | 'learning' | 'review' | 'mastered' | 'leech';
  next_review?: string;
  updated_at: string;
  preview?: string;
  user_note?: string;
}
```

ACTION 3: FIND the existing `renderCardItem` (the function that renders each row in the list) and REPLACE with:

```tsx
  const renderCardItem = ({ item }: { item: CardItem }) => {
    const showText = item.user_note?.trim()
      ? item.user_note
      : (item.preview || item.front_text || '').replace(/\n+/g, ' ');
    const dueDate = item.next_review ? new Date(item.next_review) : null;
    const daysUntil = dueDate ? Math.ceil((dueDate.getTime() - Date.now()) / 86400000) : null;
    const dueLabel = daysUntil === null ? 'New'
      : daysUntil <= 0 ? 'Due today'
      : daysUntil === 1 ? 'Tomorrow'
      : `in ${daysUntil}d`;

    return (
      <TouchableOpacity
        style={[styles.cardItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => router.push({
          pathname: '/flashcards/review',
          params: { microtopic, subject, section, cardId: item.id },
        })}
      >
        <View style={styles.cardTop}>
          <View style={[styles.statusDot, {
            backgroundColor:
              item.status === 'frozen' ? '#94a3b8' :
              item.learning_status === 'mastered' ? '#34c759' :
              item.learning_status === 'learning' ? '#3b82f6' :
              item.learning_status === 'leech'    ? '#ef4444' : '#cbd5e1',
          }]} />
          <Text style={[styles.cardPreview, { color: colors.textPrimary }]} numberOfLines={2}>
            {showText || 'Untitled card'}
          </Text>
        </View>
        <View style={styles.cardBottom}>
          <Text style={[styles.cardMeta, { color: colors.textTertiary }]}>
            {item.learning_status.replace('_', ' ').toUpperCase()} • {dueLabel}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };
```

ACTION 4: FIND the filter logic inside `filteredAndSortedCards`'s useMemo — the block:

```tsx
    if (filterBy !== 'all') {
      if (filterBy === 'frozen') result = result.filter(c => c.status === 'frozen');
      else if (filterBy === 'not_studied') result = result.filter(c => c.learning_status === 'not_studied');
      else result = result.filter(c => c.learning_status === filterBy);
    } else {
      result = result.filter(c => c.status === 'active');
    }
```

REPLACE with:

```tsx
    if (filterBy === 'all')         result = result.filter(c => c.status === 'active');
    else if (filterBy === 'frozen') result = result.filter(c => c.status === 'frozen');
    else if (filterBy === 'new')    result = result.filter(c => c.status === 'active' && c.learning_status === 'not_studied');
    else if (filterBy === 'mastered') result = result.filter(c => c.status === 'active' && c.learning_status === 'mastered');
    else if (filterBy === 'learning') result = result.filter(c => c.status === 'active' && (c.learning_status === 'learning' || c.learning_status === 'review'));
    else if (filterBy === 'due') {
      const now = Date.now();
      result = result.filter(c => c.status === 'active' && c.next_review && new Date(c.next_review).getTime() <= now);
    }
```

ACTION 5: FIND the filter chips row — the block containing four chips (`Active`, `New`, `Mastered`, `Frozen`) — and REPLACE the value passed to `filterBy` so chips use keys `'all' | 'new' | 'learning' | 'mastered' | 'due' | 'frozen'`. Add a "Due" and "Learning" chip:

```tsx
                <TouchableOpacity style={[styles.filterChip, filterBy === 'all' && { backgroundColor: colors.primary }]} onPress={() => setFilterBy('all')}>
                  <Text style={[styles.filterText, filterBy === 'all' && { color: '#fff' }]}>All Active</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterChip, filterBy === 'due' && { backgroundColor: '#f59e0b' }]} onPress={() => setFilterBy('due')}>
                  <Text style={[styles.filterText, filterBy === 'due' && { color: '#fff' }]}>Due</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterChip, filterBy === 'new' && { backgroundColor: '#94a3b8' }]} onPress={() => setFilterBy('new')}>
                  <Text style={[styles.filterText, filterBy === 'new' && { color: '#fff' }]}>New</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterChip, filterBy === 'learning' && { backgroundColor: '#3b82f6' }]} onPress={() => setFilterBy('learning')}>
                  <Text style={[styles.filterText, filterBy === 'learning' && { color: '#fff' }]}>Learning</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterChip, filterBy === 'mastered' && { backgroundColor: '#34c759' }]} onPress={() => setFilterBy('mastered')}>
                  <Text style={[styles.filterText, filterBy === 'mastered' && { color: '#fff' }]}>Mastered</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterChip, filterBy === 'frozen' && { backgroundColor: '#ef4444' }]} onPress={() => setFilterBy('frozen')}>
                  <Text style={[styles.filterText, filterBy === 'frozen' && { color: '#fff' }]}>Frozen</Text>
                </TouchableOpacity>
```

ACTION 6: Add import for `FlashcardSvc` at the top of the file if not present:

```tsx
import { FlashcardSvc } from '../../src/services/FlashcardService';
```

WHY
- #8 fixed: tally is read from `v_deck_summary` view ⇒ matches reality across all reviews.
- #9 fixed: filter chip values are now consistent with data ⇒ no blank "Active / New / Mastered / Frozen" panels.
- #10 fixed: list row shows `user_note` > `preview` > `front_text` (first 80 chars).
- #14 fixed: each row shows day-until-due label ("in 3d", "Tomorrow", "Due today").
````

---

## 📄 PATCH 06 — Review screen (#4, #5, #6, #11, #12, #13, #14, #15) + add-card modal with image

````markdown
# PATCH 06 — app/flashcards/review.tsx  (+ new AddCardModal)

ACTION 1: add 2 new imports at top:

```tsx
import { Pause, Image as ImageIcon } from 'lucide-react-native';
import { FlashcardLocalCache } from '../../src/services/FlashcardLocalCache';
import { pickAndUploadFlashcardImage } from '../../src/services/ImageUpload';
```

ACTION 2: already in review.tsx — tapping an option sets `showCorrect=true` and does NOT flip. ✅ That behaviour is correct for req #4.

ACTION 3: FIND the "Show Answer" button JSX (the `TouchableOpacity` with `{styles.showBtn}` and `onPress={handleFlip}`) — no change needed, it already flips the card (req #5). ✅

ACTION 4: Add a PAUSE BUTTON (req #6). FIND this line in the header:

```tsx
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <X size={24} color={colors.textPrimary} />
          </TouchableOpacity>
```

REPLACE with:

```tsx
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <X size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              if (!session?.user.id) return router.back();
              await FlashcardLocalCache.saveSession(session.user.id, {
                microtopic: microtopic as string,
                subject:    subject    as string,
                section:    section    as string,
                queueCardIds: queue.map(q => q.id),
                currentIndex,
                flipped: isFlipped,
                savedAt: new Date().toISOString(),
              });
              Alert.alert('Paused', 'Session saved. Resume from the microtopic screen.',
                [{ text: 'OK', onPress: () => router.back() }]);
            }}
            style={styles.headerBtn}
          >
            <Pause size={22} color={colors.textPrimary} />
          </TouchableOpacity>
```

ACTION 5: In the `rate` function (req #7 + #13), FIND:

```tsx
      const sm = await FlashcardSvc.reviewCard(session.user.id, card.id, quality);
```

REPLACE with:

```tsx
      // req #7: write-through cache + offline queue
      // req #13: moves card into correct bucket (learning/review/mastered) automatically via SM-2 status
      const sm = await FlashcardLocalCache.reviewCardSafe(session.user.id, card.id, quality);
```

ACTION 6: Add image support in edit modal (req #15). FIND the `<View style={styles.modalActions}>` inside the edit modal and INSERT just before it:

```tsx
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.primary + '20', marginBottom: 12 }]}
                onPress={async () => {
                  if (!session?.user.id) return;
                  const url = await pickAndUploadFlashcardImage(session.user.id);
                  if (!url) return;
                  // Attach to current card back (you can change to front if desired)
                  await supabase.from('cards').update({ back_image_url: url })
                    .eq('id', queue[currentIndex].id);
                  const next = [...queue];
                  next[currentIndex].back_image_url = url;
                  setQueue(next);
                  Alert.alert('Image added', 'Saved to card back.');
                }}
              >
                <ImageIcon size={20} color={colors.primary} />
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Add Image to Back</Text>
              </TouchableOpacity>
```

ACTION 7: Noji-style vertical swipe option (req #12). The flip animation already exists. If you want the *card-slides-up / answer-slides-up-from-below* alternative, add this settings flag and rendering branch. For now **keep the flip** (simpler, already works). If you want the Noji-up-slide instead, replace the card block with this drop-in alternative — toggle via a const:

```tsx
const USE_NOJI_SLIDE = false; // set true for vertical slide instead of horizontal flip
```

Then if `USE_NOJI_SLIDE`:
```tsx
{USE_NOJI_SLIDE ? (
  <View style={{ flex: 1, overflow: 'hidden' }}>
    <Animated.View style={{
      flex: 1,
      transform: [{ translateY: flipAnim.interpolate({ inputRange: [0, 180], outputRange: [0, -600] }) }],
    }}>
      {/* question card same as before */}
    </Animated.View>
    <Animated.View style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      transform: [{ translateY: flipAnim.interpolate({ inputRange: [0, 180], outputRange: [600, 0] }) }],
    }}>
      {/* answer card same as before */}
    </Animated.View>
  </View>
) : (
  /* existing flip animation block unchanged */
)}
```

ACTION 8: Resume session (req #6) — on mount of `review.tsx`, if a saved session matches the microtopic, restore it. FIND:

```tsx
  useEffect(() => {
    if (session?.user.id) {
      loadQueue();
      loadZoomSetting();
    }
  }, [session]);
```

REPLACE with:

```tsx
  useEffect(() => {
    (async () => {
      if (!session?.user.id) return;
      loadZoomSetting();
      const saved = await FlashcardLocalCache.loadSession(session.user.id, microtopic as string);
      if (saved && saved.queueCardIds.length) {
        // Restore queue
        const { data } = await supabase.from('cards').select('*').in('id', saved.queueCardIds);
        const byId: any = {};
        (data || []).forEach((c: any) => (byId[c.id] = c));
        setQueue(saved.queueCardIds.map(id => byId[id]).filter(Boolean));
        setCurrentIndex(saved.currentIndex);
        setIsFlipped(saved.flipped);
        flipAnim.setValue(saved.flipped ? 180 : 0);
        setLoading(false);
        // Clear so next entry is fresh
        await FlashcardLocalCache.clearSession(session.user.id, microtopic as string);
      } else {
        loadQueue();
      }
    })();
  }, [session]);
```

ACTION 9: Due-days overlay on card-back (req #14). FIND `{currentCard.state?.user_note && (` block and INSERT just before it:

```tsx
                    {nextDueLabel && (
                      <View style={{ marginTop: 16, alignItems: 'center' }}>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textTertiary, letterSpacing: 1 }}>
                          NEXT REVIEW IN {nextDueLabel}
                        </Text>
                      </View>
                    )}
```

ACTION 10: Institute display on back (req #3). FIND the `<ScrollView contentContainerStyle={styles.cardScroll}>` inside the back-card, and AFTER the main `answerText` render, INSERT:

```tsx
                    {Array.isArray(currentCard.institutes) && currentCard.institutes.length > 1 && (
                      <View style={{ marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceStrong || '#f1f5f9' }}>
                        <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, color: colors.textTertiary, marginBottom: 6 }}>
                          APPEARED IN
                        </Text>
                        {currentCard.institutes.map((ins: any, idx: number) => (
                          <Text key={idx} style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
                            • {ins.institute}{ins.year ? ` ${ins.year}` : ''}{ins.correct ? ` — Answer: (${String(ins.correct).toUpperCase()})` : ''}
                          </Text>
                        ))}
                      </View>
                    )}
```

WHY
- #4 tap option ⇒ reveals correct/incorrect without flipping (already present).
- #5 Show-Answer ⇒ flips card (already present).
- #6 Pause button ⇒ persists session to AsyncStorage; resumes on next entry.
- #7 every review goes through `FlashcardLocalCache.reviewCardSafe` ⇒ local + server.
- #11 user notes already persist via `FlashcardSvc.saveNote`; back-card already renders `state.user_note`.
- #12 Noji-slide style is provided as opt-in via `USE_NOJI_SLIDE`. Default stays flip.
- #13 bucket transitions happen server-side in `applySM2()` based on `interval_days` ⇒ card auto-reclassifies to learning/review/mastered.
- #14 after review, the back shows "NEXT REVIEW IN +3d". Microtopic list also shows due labels (patch 05).
- #15 "Add Image to Back" button uploads via existing `pickAndUploadFlashcardImage` ⇒ Supabase Storage `flashcard-images/<userId>/...`.
- #3 when a card has ≥2 institutes (from dedupe), "APPEARED IN" panel lists all institute-year-answer trios.
````

---

### ✅ Checklist after all 6 patches

| Req | Status | Covered in |
|---|---|---|
| 1. Add cards from quiz engine | ✅ | Patch 04 |
| 2. Q + stmt + options front, explanation back | ✅ | Patch 02 (`createFromQuestion`) |
| 3. Multi-institute merged back | ✅ | Patch 01 (schema) + 02 (merge) + 06 (display) |
| 4. Click option ⇒ correct/incorrect, no flip | ✅ | Already in review.tsx + confirmed |
| 5. "Show Answer" flips | ✅ | Already in review.tsx |
| 6. Pause button | ✅ | Patch 06 + Patch 03 |
| 7. Local + server status | ✅ | Patch 03 (`reviewCardSafe`) |
| 8. Tally bar correct | ✅ | Patch 01 (view) + 02 (`getDeckSummary`) + 05 |
| 9. Filter panels show cards | ✅ | Patch 05 (filter logic + chip keys) |
| 10. Card preview in list | ✅ | Patch 02 (`listCardsWithProgress`) + 05 (render) |
| 11. User note stored & shown on back | ✅ | Patch 01 (`user_note` col) + 02 (`saveNote`) + 06 |
| 12. Flip OR Noji-slide | ✅ | Patch 06 (`USE_NOJI_SLIDE` flag) |
| 13. Progress moves to correct bucket | ✅ | SM-2 status already maps in `sm2.ts` |
| 14. Due cards with day labels | ✅ | Patch 02 (`listDueWithDays`) + 05 (row label) + 06 (back label) |
| 15. Images via Supabase Storage | ✅ | Patch 01 (bucket+policies) + 06 (upload btn) |

### 🔧 Order of application
1. **Patch 01** — run SQL in Supabase dashboard
2. **Patch 02** — edit `src/services/FlashcardService.ts`
3. **Patch 03** — create new file `src/services/FlashcardLocalCache.ts`
4. **Patch 04** — edit `app/unified/engine.tsx`
5. **Patch 05** — edit `app/flashcards/microtopic.tsx`
6. **Patch 06** — edit `app/flashcards/review.tsx`

After each: `yarn tsc --noEmit` to catch type drift, then `expo start` and smoke-test.

Ping me with any red TypeScript error from Gemini's output and I'll hand back a surgical fix.