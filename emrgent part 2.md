Here's a single `.patch` file. It contains everything that can be applied **safely and atomically** — i.e. all new files (SRS engine, services, SQL migrations, settings screen, RichTextField, NoteHierarchyService) and the deletion of the legacy `src/lib/sm2.ts`.

> **Honest disclaimer**: I can produce a clean, reliable patch only for **file creations and deletions**. Surgical edits to large existing files (like `app/flashcards/review.tsx` or `app/notes/index.tsx`) require exact byte-for-byte line context that I don't have — those would fail `git apply`. Apply those edits manually using the previous markdown instructions I sent.

## Steps

1. Save the block below as `srs-bundle.patch` at your repo root.
2. Run:
   ```bash
   git checkout -b srs-bundle
   git apply --whitespace=fix srs-bundle.patch
   git add -A
   git commit -m "SRS engine + Notes hierarchy + Dashboard widget size + RichTextField"
   ```
3. Run the three SQL migrations in Supabase SQL Editor (paths printed in the patch).
4. Apply the existing-file edits manually using my earlier markdown.

---

```diff
diff --git a/src/lib/sm2.ts b/src/lib/sm2.ts
deleted file mode 100644
--- a/src/lib/sm2.ts
+++ /dev/null
@@ -1,24 +0,0 @@
-// SM-2 style spaced repetition algorithm
-// rating: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy
-
-export type SM2State = { ease_factor: number; interval_days: number; repetitions: number };
-
-export function sm2(prev: SM2State, rating: 0 | 1 | 2 | 3): SM2State {
-  let { ease_factor, interval_days, repetitions } = prev;
-  const q = rating === 0 ? 2 : rating === 1 ? 3 : rating === 2 ? 4 : 5;
-  if (q < 3) {
-    repetitions = 0;
-    interval_days = 1;
-  } else {
-    repetitions += 1;
-    if (repetitions === 1) interval_days = 1;
-    else if (repetitions === 2) interval_days = 3;
-    else interval_days = Math.round(interval_days * ease_factor);
-  }
-  ease_factor = Math.max(1.3, ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
-  return { ease_factor, interval_days, repetitions };
-}
-export function nextDueIso(intervalDays: number) {
-  const d = new Date();
-  d.setDate(d.getDate() + Math.max(intervalDays, 0));
-  return d.toISOString();
-}
diff --git a/src/services/sm2.ts b/src/services/sm2.ts
new file mode 100644
--- /dev/null
+++ b/src/services/sm2.ts
@@ -0,0 +1,170 @@
+// CLIENT-SIDE Spaced Repetition engine. Pure functions. Single source of truth.
+export type Rating = 'again' | 'hard' | 'good' | 'easy';
+
+export interface SrsSettings {
+  learningStepsMinutes: number[];
+  graduatingIntervalDays: number;
+  easyIntervalDays: number;
+  startingEase: number;
+  easyBonus: number;
+  intervalModifier: number;
+  hardMultiplier: number;
+  maxIntervalDays: number;
+  minEase: number;
+  leechThreshold: number;
+}
+
+export const DEFAULT_SRS_SETTINGS: SrsSettings = {
+  learningStepsMinutes: [1, 10],
+  graduatingIntervalDays: 1,
+  easyIntervalDays: 4,
+  startingEase: 2.5,
+  easyBonus: 1.3,
+  intervalModifier: 1.0,
+  hardMultiplier: 1.2,
+  maxIntervalDays: 365,
+  minEase: 1.3,
+  leechThreshold: 8,
+};
+
+export interface SrsCardState {
+  ease_factor: number;
+  interval_days: number;
+  interval_minutes?: number;
+  repetitions: number;
+  lapses: number;
+  learning_step: number | null;
+  status: 'learning' | 'review' | 'mastered' | 'leech';
+}
+
+export interface SrsResult extends SrsCardState {
+  next_review: Date;
+  delta_minutes: number;
+  delta_label: string;
+  lapsed: boolean;
+  in_learning: boolean;
+}
+
+const QUALITY: Record<Rating, number> = { again: 0, hard: 3, good: 4, easy: 5 };
+export const ratingToQuality = (r: Rating) => QUALITY[r];
+
+export function formatDelta(minutes: number): string {
+  if (minutes < 60) return `+${Math.max(1, Math.round(minutes))}m`;
+  const days = minutes / 1440;
+  if (days < 1) return `+${Math.round(minutes / 60)}h`;
+  if (days < 30) return `+${Math.round(days)}d`;
+  if (days < 365) return `+${Math.round(days / 30)}mo`;
+  return `+${(days / 365).toFixed(1)}y`;
+}
+
+const clampInterval = (i: number, s: SrsSettings) =>
+  Math.min(Math.max(1, Math.round(i)), s.maxIntervalDays);
+
+export function applySrs(
+  prev: SrsCardState,
+  rating: Rating,
+  settings: SrsSettings = DEFAULT_SRS_SETTINGS
+): SrsResult {
+  let { ease_factor, interval_days, repetitions, lapses, learning_step, status } = prev;
+  if (!ease_factor || ease_factor < settings.minEase) ease_factor = settings.startingEase;
+
+  let lapsed = false;
+  let interval_minutes = 0;
+
+  if (learning_step !== null) {
+    if (rating === 'again') {
+      learning_step = 0;
+      interval_minutes = settings.learningStepsMinutes[0];
+      status = 'learning';
+    } else if (rating === 'hard') {
+      interval_minutes = Math.round(settings.learningStepsMinutes[learning_step] * 1.5);
+      status = 'learning';
+    } else if (rating === 'good') {
+      const next = learning_step + 1;
+      if (next >= settings.learningStepsMinutes.length) {
+        learning_step = null;
+        repetitions = 1;
+        interval_days = clampInterval(settings.graduatingIntervalDays, settings);
+        status = 'review';
+      } else {
+        learning_step = next;
+        interval_minutes = settings.learningStepsMinutes[next];
+      }
+    } else if (rating === 'easy') {
+      learning_step = null;
+      repetitions = 1;
+      interval_days = clampInterval(settings.easyIntervalDays, settings);
+      status = 'review';
+    }
+  } else {
+    if (rating === 'again') {
+      lapses += 1; lapsed = true;
+      repetitions = 0;
+      learning_step = 0;
+      interval_minutes = settings.learningStepsMinutes[0];
+      ease_factor = Math.max(settings.minEase, ease_factor - 0.20);
+      status = 'learning';
+    } else {
+      let nextInterval: number;
+      if (repetitions === 0)      nextInterval = settings.graduatingIntervalDays;
+      else if (repetitions === 1) nextInterval = 6;
+      else                        nextInterval = interval_days * ease_factor;
+
+      if (rating === 'hard') {
+        nextInterval = Math.max(interval_days * settings.hardMultiplier, interval_days + 1);
+      } else if (rating === 'easy') {
+        nextInterval = nextInterval * settings.easyBonus;
+        ease_factor += 0.15;
+      }
+      nextInterval = nextInterval * settings.intervalModifier;
+      interval_days = clampInterval(nextInterval, settings);
+      repetitions += 1;
+      status = interval_days >= 90 ? 'mastered' : 'review';
+    }
+    if (ease_factor < settings.minEase) ease_factor = settings.minEase;
+    ease_factor = Math.round(ease_factor * 100) / 100;
+  }
+
+  if (lapses >= settings.leechThreshold && interval_days <= 1) status = 'leech';
+
+  const next_review = new Date();
+  if (learning_step !== null) next_review.setMinutes(next_review.getMinutes() + interval_minutes);
+  else                        next_review.setDate(next_review.getDate() + interval_days);
+
+  const delta_minutes = learning_step !== null ? interval_minutes : interval_days * 1440;
+
+  return {
+    ease_factor,
+    interval_days: learning_step !== null ? 0 : interval_days,
+    interval_minutes: learning_step !== null ? interval_minutes : 0,
+    repetitions,
+    lapses,
+    learning_step,
+    status,
+    next_review,
+    delta_minutes,
+    delta_label: formatDelta(delta_minutes),
+    lapsed,
+    in_learning: learning_step !== null,
+  };
+}
+
+export function previewAll(state: SrsCardState, settings: SrsSettings = DEFAULT_SRS_SETTINGS) {
+  return {
+    again: applySrs(state, 'again', settings),
+    hard:  applySrs(state, 'hard',  settings),
+    good:  applySrs(state, 'good',  settings),
+    easy:  applySrs(state, 'easy',  settings),
+  };
+}
+
+export function nextDueIso(intervalDays: number) {
+  const d = new Date(); d.setDate(d.getDate() + Math.max(intervalDays, 0));
+  return d.toISOString();
+}
+
+export function applySM2(input: { ease_factor:number; interval_days:number; repetitions:number; quality:number }, lapses = 0) {
+  const q = Math.max(0, Math.min(5, Math.round(input.quality)));
+  const rating: Rating = q < 3 ? 'again' : q === 3 ? 'hard' : q === 4 ? 'good' : 'easy';
+  const out = applySrs({
+    ease_factor: input.ease_factor, interval_days: input.interval_days,
+    repetitions: input.repetitions, lapses,
+    learning_step: input.repetitions === 0 ? 0 : null,
+    status: input.repetitions === 0 ? 'learning' : 'review',
+  }, rating);
+  return { ease_factor: out.ease_factor, interval_days: out.interval_days || 1,
+           repetitions: out.repetitions, next_review: out.next_review,
+           status: out.status, lapsed: out.lapsed };
+}
diff --git a/src/services/SrsSettingsService.ts b/src/services/SrsSettingsService.ts
new file mode 100644
--- /dev/null
+++ b/src/services/SrsSettingsService.ts
@@ -0,0 +1,75 @@
+import AsyncStorage from '@react-native-async-storage/async-storage';
+import { supabase } from '../lib/supabase';
+import { DEFAULT_SRS_SETTINGS, SrsSettings } from './sm2';
+
+const KEY = (uid: string) => `srs_settings_${uid}`;
+
+function fromJson(j: any): SrsSettings {
+  return {
+    learningStepsMinutes:    j?.learning_steps_minutes    ?? DEFAULT_SRS_SETTINGS.learningStepsMinutes,
+    graduatingIntervalDays:  j?.graduating_interval_days  ?? DEFAULT_SRS_SETTINGS.graduatingIntervalDays,
+    easyIntervalDays:        j?.easy_interval_days        ?? DEFAULT_SRS_SETTINGS.easyIntervalDays,
+    startingEase:    Number(j?.starting_ease     ?? DEFAULT_SRS_SETTINGS.startingEase),
+    easyBonus:       Number(j?.easy_bonus        ?? DEFAULT_SRS_SETTINGS.easyBonus),
+    intervalModifier:Number(j?.interval_modifier ?? DEFAULT_SRS_SETTINGS.intervalModifier),
+    hardMultiplier:  Number(j?.hard_multiplier   ?? DEFAULT_SRS_SETTINGS.hardMultiplier),
+    maxIntervalDays: j?.max_interval_days        ?? DEFAULT_SRS_SETTINGS.maxIntervalDays,
+    minEase:         DEFAULT_SRS_SETTINGS.minEase,
+    leechThreshold:  DEFAULT_SRS_SETTINGS.leechThreshold,
+  };
+}
+
+function toJsonMerge(prev: any, s: SrsSettings) {
+  return {
+    ...(prev || {}),
+    easy:  prev?.easy  ?? 7,
+    good:  prev?.good  ?? 3,
+    hard:  prev?.hard  ?? 1,
+    again: prev?.again ?? 0,
+    learning_steps_minutes:   s.learningStepsMinutes,
+    graduating_interval_days: s.graduatingIntervalDays,
+    easy_interval_days:       s.easyIntervalDays,
+    starting_ease:            s.startingEase,
+    easy_bonus:               s.easyBonus,
+    interval_modifier:        s.intervalModifier,
+    hard_multiplier:          s.hardMultiplier,
+    max_interval_days:        s.maxIntervalDays,
+  };
+}
+
+export const SrsSettingsSvc = {
+  async load(userId: string): Promise<SrsSettings> {
+    const cached = await AsyncStorage.getItem(KEY(userId));
+    if (cached) { try { return { ...DEFAULT_SRS_SETTINGS, ...JSON.parse(cached) }; } catch {} }
+    const { data } = await supabase
+      .from('user_settings').select('deck_intervals').eq('user_id', userId).maybeSingle();
+    const s = fromJson(data?.deck_intervals);
+    await AsyncStorage.setItem(KEY(userId), JSON.stringify(s));
+    return s;
+  },
+  async save(userId: string, s: SrsSettings) {
+    await AsyncStorage.setItem(KEY(userId), JSON.stringify(s));
+    const { data } = await supabase
+      .from('user_settings').select('deck_intervals').eq('user_id', userId).maybeSingle();
+    const merged = toJsonMerge(data?.deck_intervals, s);
+    await supabase.from('user_settings')
+      .upsert({ user_id: userId, deck_intervals: merged, updated_at: new Date().toISOString() },
+              { onConflict: 'user_id' });
+  },
+};
diff --git a/src/services/NoteHierarchyService.ts b/src/services/NoteHierarchyService.ts
new file mode 100644
--- /dev/null
+++ b/src/services/NoteHierarchyService.ts
@@ -0,0 +1,49 @@
+import { supabase } from '../lib/supabase';
+
+export type NoteNode = {
+  id: string;
+  user_id: string;
+  parent_id: string | null;
+  type: 'folder' | 'note';
+  title: string;
+  note_id: string | null;
+  is_pinned?: boolean;
+  is_archived?: boolean;
+};
+
+export const NoteHierarchy = {
+  async listAll(userId: string): Promise<NoteNode[]> {
+    const { data, error } = await supabase
+      .from('user_note_nodes').select('*')
+      .eq('user_id', userId).eq('is_archived', false)
+      .order('parent_id', { ascending: true, nullsFirst: true });
+    if (error) throw error;
+    return (data || []) as NoteNode[];
+  },
+  async createFolder(userId: string, title: string, parentId: string | null) {
+    const { data, error } = await supabase.from('user_note_nodes')
+      .insert({ user_id: userId, parent_id: parentId, type: 'folder', title })
+      .select().single();
+    if (error) throw error;
+    return data;
+  },
+  async rename(userId: string, nodeId: string, title: string) {
+    const { error } = await supabase.rpc('rename_note_node', {
+      p_node_id: nodeId, p_user_id: userId, p_title: title,
+    });
+    if (error) throw error;
+  },
+  async move(userId: string, nodeId: string, newParentId: string | null) {
+    const { error } = await supabase.rpc('move_note_node', {
+      p_node_id: nodeId, p_user_id: userId, p_new_parent_id: newParentId,
+    });
+    if (error) throw error;
+  },
+  async deleteCascade(userId: string, nodeId: string) {
+    const { error } = await supabase.rpc('delete_note_node_cascade', {
+      p_node_id: nodeId, p_user_id: userId,
+    });
+    if (error) throw error;
+  },
+};
diff --git a/src/components/RichTextField.tsx b/src/components/RichTextField.tsx
new file mode 100644
--- /dev/null
+++ b/src/components/RichTextField.tsx
@@ -0,0 +1,73 @@
+import React, { useRef, useState } from 'react';
+import { View, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
+import { Bold, Italic, Underline, Highlighter, List as ListIcon, Hash } from 'lucide-react-native';
+
+type Tag = 'bold' | 'italic' | 'underline' | 'mark' | 'bullet' | 'h2';
+
+const wrap = (txt: string, sel: { start: number; end: number }, openTag: string, closeTag: string) => {
+  const before = txt.slice(0, sel.start);
+  const middle = txt.slice(sel.start, sel.end) || 'text';
+  const after  = txt.slice(sel.end);
+  return { value: `${before}${openTag}${middle}${closeTag}${after}`,
+           cursor: before.length + openTag.length + middle.length + closeTag.length };
+};
+
+export function RichTextField(props: {
+  value: string; onChangeText: (s: string) => void;
+  placeholder?: string; minHeight?: number;
+  primaryColor: string; surface: string; textColor: string; border: string;
+}) {
+  const ref = useRef<TextInput>(null);
+  const [sel, setSel] = useState({ start: 0, end: 0 });
+  const apply = (tag: Tag) => {
+    const map: Record<Tag, [string, string]> = {
+      bold: ['**', '**'], italic: ['_', '_'],
+      underline: ['<u>', '</u>'], mark: ['<mark>', '</mark>'],
+      bullet: ['\n- ', ''], h2: ['\n## ', ''],
+    };
+    const [o, c] = map[tag];
+    const { value, cursor } = wrap(props.value, sel, o, c);
+    props.onChangeText(value);
+    setTimeout(() => ref.current?.setNativeProps({ selection: { start: cursor, end: cursor } }), 0);
+  };
+  const Btn = ({ tag, Icon }: { tag: Tag; Icon: any }) => (
+    <TouchableOpacity onPress={() => apply(tag)} style={s.btn}>
+      <Icon size={16} color={props.primaryColor} />
+    </TouchableOpacity>
+  );
+  return (
+    <View>
+      <View style={[s.toolbar, { borderColor: props.border, backgroundColor: props.surface }]}>
+        <Btn tag="bold" Icon={Bold} /><Btn tag="italic" Icon={Italic} />
+        <Btn tag="underline" Icon={Underline} /><Btn tag="mark" Icon={Highlighter} />
+        <Btn tag="bullet" Icon={ListIcon} /><Btn tag="h2" Icon={Hash} />
+      </View>
+      <TextInput ref={ref} multiline value={props.value}
+        onChangeText={props.onChangeText}
+        onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
+        placeholder={props.placeholder}
+        placeholderTextColor={props.border}
+        style={[s.input, { borderColor: props.border, backgroundColor: props.surface, color: props.textColor, minHeight: props.minHeight ?? 100 }]}
+      />
+    </View>
+  );
+}
+
+const s = StyleSheet.create({
+  toolbar: { flexDirection: 'row', gap: 6, padding: 8, borderWidth: 1, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
+  btn: { padding: 8, borderRadius: 8 },
+  input: { borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, padding: 12, textAlignVertical: 'top', fontSize: 15 },
+});
diff --git a/app/flashcards/settings.tsx b/app/flashcards/settings.tsx
new file mode 100644
--- /dev/null
+++ b/app/flashcards/settings.tsx
@@ -0,0 +1,99 @@
+import React, { useEffect, useState } from 'react';
+import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
+import { useRouter } from 'expo-router';
+import { useAuth } from '../../src/context/AuthContext';
+import { useTheme } from '../../src/context/ThemeContext';
+import { SrsSettingsSvc } from '../../src/services/SrsSettingsService';
+import { DEFAULT_SRS_SETTINGS, SrsSettings } from '../../src/services/sm2';
+
+export default function SrsSettingsScreen() {
+  const { colors } = useTheme();
+  const router = useRouter();
+  const { session } = useAuth();
+  const [s, setS] = useState<SrsSettings>(DEFAULT_SRS_SETTINGS);
+  const [loading, setLoading] = useState(true);
+  const [saving, setSaving] = useState(false);
+
+  useEffect(() => {
+    if (!session?.user.id) return;
+    SrsSettingsSvc.load(session.user.id).then((x) => { setS(x); setLoading(false); });
+  }, [session]);
+
+  const save = async () => {
+    if (!session?.user.id) return;
+    setSaving(true);
+    try { await SrsSettingsSvc.save(session.user.id, s); router.back(); }
+    catch (e: any) { Alert.alert('Save failed', e.message || ''); }
+    finally { setSaving(false); }
+  };
+
+  const reset = () => setS(DEFAULT_SRS_SETTINGS);
+
+  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />;
+
+  const Field = (props: { label: string; value: string; onChange: (v: string) => void; testID: string }) => (
+    <View style={styles.field}>
+      <Text style={[styles.label, { color: colors.textTertiary }]}>{props.label}</Text>
+      <TextInput
+        testID={props.testID}
+        value={props.value}
+        onChangeText={props.onChange}
+        style={[styles.input, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surface }]}
+      />
+    </View>
+  );
+
+  return (
+    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
+      <Text style={[styles.title, { color: colors.textPrimary }]}>SRS Settings</Text>
+
+      <Field testID="srs-learning-steps" label="Learning Steps (minutes, comma-separated)"
+        value={s.learningStepsMinutes.join(', ')}
+        onChange={(v) => setS({ ...s, learningStepsMinutes: v.split(',').map(x => parseInt(x.trim(), 10)).filter(Boolean) })} />
+
+      <Field testID="srs-graduating" label="Graduating Interval (days)"
+        value={String(s.graduatingIntervalDays)}
+        onChange={(v) => setS({ ...s, graduatingIntervalDays: parseInt(v || '1', 10) })} />
+
+      <Field testID="srs-easy-interval" label="Easy Interval (days)"
+        value={String(s.easyIntervalDays)}
+        onChange={(v) => setS({ ...s, easyIntervalDays: parseInt(v || '4', 10) })} />
+
+      <Field testID="srs-starting-ease" label="Starting Ease"
+        value={String(s.startingEase)}
+        onChange={(v) => setS({ ...s, startingEase: parseFloat(v || '2.5') })} />
+
+      <Field testID="srs-easy-bonus" label="Easy Bonus (e.g. 1.30)"
+        value={String(s.easyBonus)}
+        onChange={(v) => setS({ ...s, easyBonus: parseFloat(v || '1.3') })} />
+
+      <Field testID="srs-interval-modifier" label="Interval Modifier (1.00 = normal)"
+        value={String(s.intervalModifier)}
+        onChange={(v) => setS({ ...s, intervalModifier: parseFloat(v || '1.0') })} />
+
+      <Field testID="srs-hard-mult" label="Hard Multiplier"
+        value={String(s.hardMultiplier)}
+        onChange={(v) => setS({ ...s, hardMultiplier: parseFloat(v || '1.2') })} />
+
+      <Field testID="srs-max-interval" label="Max Interval (days)"
+        value={String(s.maxIntervalDays)}
+        onChange={(v) => setS({ ...s, maxIntervalDays: parseInt(v || '365', 10) })} />
+
+      <TouchableOpacity testID="srs-save" onPress={save} disabled={saving}
+        style={[styles.btn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}>
+        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save</Text>}
+      </TouchableOpacity>
+      <TouchableOpacity testID="srs-reset" onPress={reset} style={[styles.btn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}>
+        <Text style={[styles.btnText, { color: colors.textPrimary }]}>Reset to Defaults</Text>
+      </TouchableOpacity>
+    </ScrollView>
+  );
+}
+
+const styles = StyleSheet.create({
+  title: { fontSize: 22, fontWeight: '900', marginBottom: 16 },
+  field: { marginBottom: 14 },
+  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
+  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15 },
+  btn: { padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 12 },
+  btnText: { color: '#fff', fontWeight: '900', letterSpacing: 1 },
+});
diff --git a/supabase/migration-srs-v5.sql b/supabase/migration-srs-v5.sql
new file mode 100644
--- /dev/null
+++ b/supabase/migration-srs-v5.sql
@@ -0,0 +1,17 @@
+-- SRS engine v5: minimal additive columns (your schema already has lapses, again_count, dirty, client_updated_at, last_quality)
+ALTER TABLE public.user_cards
+  ADD COLUMN IF NOT EXISTS learning_step    smallint,
+  ADD COLUMN IF NOT EXISTS interval_minutes integer NOT NULL DEFAULT 0;
+
+ALTER TABLE public.card_reviews
+  ADD COLUMN IF NOT EXISTS rating        text,
+  ADD COLUMN IF NOT EXISTS learning_step smallint,
+  ADD COLUMN IF NOT EXISTS prev_minutes  integer,
+  ADD COLUMN IF NOT EXISTS new_minutes   integer;
+
+-- Settings live in existing user_settings.deck_intervals jsonb. No new table.
+-- Confirm columns:
+-- SELECT column_name FROM information_schema.columns
+--   WHERE table_name='user_cards'
+--     AND column_name IN ('learning_step','interval_minutes','lapses','again_count','dirty','client_updated_at','last_quality','learning_status');
diff --git a/supabase/migration-notes-hierarchy-v2.sql b/supabase/migration-notes-hierarchy-v2.sql
new file mode 100644
--- /dev/null
+++ b/supabase/migration-notes-hierarchy-v2.sql
@@ -0,0 +1,76 @@
+-- Notes hierarchy: SQL functions used by NoteHierarchyService against existing user_note_nodes.
+
+CREATE OR REPLACE FUNCTION public.rename_note_node(p_node_id uuid, p_user_id uuid, p_title text)
+RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
+BEGIN
+  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
+    RAISE EXCEPTION 'title required';
+  END IF;
+  UPDATE public.user_note_nodes
+     SET title = trim(p_title), updated_at = now()
+   WHERE id = p_node_id AND user_id = p_user_id;
+
+  UPDATE public.user_notes n
+     SET title = trim(p_title), updated_at = now()
+    FROM public.user_note_nodes nn
+   WHERE nn.id = p_node_id AND nn.user_id = p_user_id
+     AND nn.type = 'note' AND nn.note_id = n.id;
+END $$;
+
+CREATE OR REPLACE FUNCTION public.move_note_node(
+  p_node_id uuid, p_user_id uuid, p_new_parent_id uuid
+) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
+DECLARE
+  v_kind text;
+  v_cycle int;
+BEGIN
+  SELECT type INTO v_kind FROM public.user_note_nodes
+   WHERE id = p_node_id AND user_id = p_user_id;
+  IF v_kind IS NULL THEN RAISE EXCEPTION 'node not found'; END IF;
+
+  IF p_new_parent_id IS NOT NULL THEN
+    PERFORM 1 FROM public.user_note_nodes
+      WHERE id = p_new_parent_id AND user_id = p_user_id AND type = 'folder';
+    IF NOT FOUND THEN RAISE EXCEPTION 'parent must be a folder'; END IF;
+
+    WITH RECURSIVE chain AS (
+      SELECT id, parent_id FROM public.user_note_nodes
+       WHERE id = p_new_parent_id AND user_id = p_user_id
+      UNION ALL
+      SELECT n.id, n.parent_id FROM public.user_note_nodes n
+       JOIN chain c ON n.id = c.parent_id
+       WHERE n.user_id = p_user_id
+    )
+    SELECT count(*) INTO v_cycle FROM chain WHERE id = p_node_id;
+    IF v_cycle > 0 THEN RAISE EXCEPTION 'cannot move node into its own descendant'; END IF;
+  END IF;
+
+  UPDATE public.user_note_nodes
+     SET parent_id = p_new_parent_id, updated_at = now()
+   WHERE id = p_node_id AND user_id = p_user_id;
+END $$;
+
+CREATE OR REPLACE FUNCTION public.delete_note_node_cascade(p_node_id uuid, p_user_id uuid)
+RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
+DECLARE
+  v_note_ids uuid[];
+BEGIN
+  WITH RECURSIVE sub AS (
+    SELECT id, note_id FROM public.user_note_nodes
+     WHERE id = p_node_id AND user_id = p_user_id
+    UNION ALL
+    SELECT n.id, n.note_id FROM public.user_note_nodes n
+     JOIN sub s ON n.parent_id = s.id
+     WHERE n.user_id = p_user_id
+  )
+  SELECT array_agg(note_id) INTO v_note_ids FROM sub WHERE note_id IS NOT NULL;
+
+  DELETE FROM public.user_note_nodes WHERE id = p_node_id AND user_id = p_user_id;
+
+  IF v_note_ids IS NOT NULL THEN
+    DELETE FROM public.user_notes WHERE id = ANY(v_note_ids) AND user_id = p_user_id;
+  END IF;
+END $$;
+
+GRANT EXECUTE ON FUNCTION public.rename_note_node, public.move_note_node, public.delete_note_node_cascade TO authenticated;
diff --git a/supabase/migration-widgets-size.sql b/supabase/migration-widgets-size.sql
new file mode 100644
--- /dev/null
+++ b/supabase/migration-widgets-size.sql
@@ -0,0 +1,5 @@
+-- Allow per-user widget size override (half-tile vs full-row)
+ALTER TABLE public.user_widgets
+  ADD COLUMN IF NOT EXISTS size text NOT NULL DEFAULT 'half'
+  CHECK (size IN ('half','full'));
diff --git a/_PATCHES/README.md b/_PATCHES/README.md
new file mode 100644
--- /dev/null
+++ b/_PATCHES/README.md
@@ -0,0 +1,52 @@
+# Manual edits required (cannot be auto-applied safely)
+
+After running `git apply srs-bundle.patch`, complete these surgical edits.
+The exact code blocks are in the chat history under sections §5, §6 and PARTs A/B/C.
+
+## 1. `src/services/FlashcardLocalCache.ts`
+- Replace `reviewCardSafe(userId, cardId, quality)` with the rating-based version using
+  `applySrs` from `src/services/sm2`. Maps onto YOUR existing columns:
+  `ease_factor, interval_days, repetitions, lapses, again_count, last_quality,
+   learning_status, dirty, client_updated_at, times_seen, next_review, last_reviewed`.
+- Add `_flushReviewOutbox(userId)` and `syncDirty(userId)` helpers.
+
+## 2. `app/flashcards/review.tsx`
+- Import `applySrs, previewAll, Rating, SrsCardState` from `../../src/services/sm2`.
+- Load settings via `SrsSettingsSvc.load(userId)`.
+- Replace the 5-button row (`Again/Hard/Good/Easy/Perfect`) with 4 rating buttons
+  showing dynamic `delta_label` from `previewAll(cardState, settings)`.
+- Convert `rate(quality:number)` → `rate(rating:Rating)`.
+- Switch the queue to `{ card, readyAt }[]` and re-queue learning-step cards
+  in the same session.
+- Add header icon → `router.push('/flashcards/settings')`.
+
+## 3. `app/notes/index.tsx`
+- Delete the three `Alert.alert("Folder Actions", ...)` long-press menus.
+- Replace tree rendering of `node_subjects/node_sections/node_microtopics`
+  with a recursive `<TreeRow>` over `NoteHierarchy.listAll(userId)`.
+- Wire long-press → unified action sheet with Rename / Move / Delete.
+- Implement Move picker that calls `NoteHierarchy.move(userId, nodeId, newParentId)`.
+- Use `NoteHierarchy.deleteCascade(...)` for delete.
+
+## 4. `src/components/AddBlockToFlashcardSheet.tsx`
+- Replace the two front/back `<TextInput>` blocks with `<RichTextField .../>` from `./RichTextField`.
+- Pass `primaryColor`, `surface`, `textColor`, `border` from your theme tokens.
+
+## 5. `src/services/WidgetService.ts`
+- Add `size: 'half' | 'full'` to the `Widget` type.
+- Add `DEFAULT_SIZE` map and use it in `ensureSeeded`.
+- Add `setSize(userId, id, size)` method.
+
+## 6. `src/components/widgets/CoreWidgets.tsx` (`ws` styles)
+- `card.height: '100%'` → `card.minHeight: 130, width: '100%'`.
+- `half.flex: 1` → `half.width: '100%', minHeight: 130`.
+- `full` add `minHeight: 150`.
+
+## 7. `app/(tabs)/index.tsx`
+- Add Edit pill in header that toggles `isEditMode`.
+- Group widgets into `[half, half]` / `[full]` rows in a `useMemo`.
+- Always render a red `×` archive button when `isEditMode` is true.
+- Add a `HALF / FULL` toggle button per widget that calls `WidgetService.setSize`.
+
+## 8. SQL — run in Supabase SQL editor
+- `supabase/migration-srs-v5.sql`
+- `supabase/migration-notes-hierarchy-v2.sql`
+- `supabase/migration-widgets-size.sql`
```

---

### What this patch DOES vs DOES NOT do

| ✅ Auto-applied by `git apply` | ⚠️ You must edit manually (see `_PATCHES/README.md`) |
|---|---|
| Delete `src/lib/sm2.ts` | `src/services/FlashcardLocalCache.ts` (replace `reviewCardSafe`) |
| Create `src/services/sm2.ts` (new SRS engine) | `app/flashcards/review.tsx` (4 buttons + dynamic labels + re-queue) |
| Create `src/services/SrsSettingsService.ts` | `app/notes/index.tsx` (recursive tree + action sheet) |
| Create `src/services/NoteHierarchyService.ts` | `src/components/AddBlockToFlashcardSheet.tsx` (use RichTextField) |
| Create `src/components/RichTextField.tsx` | `src/services/WidgetService.ts` (add size field) |
| Create `app/flashcards/settings.tsx` | `src/components/widgets/CoreWidgets.tsx` (`ws` styles) |
| Create 3 SQL migrations | `app/(tabs)/index.tsx` (Edit pill + size toggle) |

If `git apply` rejects any hunk, run `git apply --3way srs-bundle.patch` so it falls back to a 3-way merge.