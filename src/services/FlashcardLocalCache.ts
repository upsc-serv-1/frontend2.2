import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { FlashcardSvc, CardState } from './FlashcardService';
import { applySrs, Rating, SrsResult, SrsSettings, DEFAULT_SRS_SETTINGS } from './sm2';
import { SrsSettingsSvc } from './SrsSettingsService';
import { LearningStatus } from '../types/flashcards';

const SESSION_KEY = (uid: string, mt: string) => `fc.session.${uid}.${mt}`;
const STATE_KEY = (uid: string, cid: string) => `fc.state.${uid}.${cid}`;
const REVIEW_OUTBOX_KEY = (uid: string) => `review_outbox_${uid}`;

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
  // --- SESSION MGMT ---
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

  // --- SRS STATE CACHE ---
  async readState(userId: string, cardId: string) {
    const raw = await AsyncStorage.getItem(STATE_KEY(userId, cardId));
    return raw ? JSON.parse(raw) : null;
  },

  async _saveState(userId: string, cardId: string, state: any) {
    await AsyncStorage.setItem(STATE_KEY(userId, cardId), JSON.stringify(state));
  },

  // --- REVIEW LOG OUTBOX ---
  async _enqueueReviewLog(userId: string, log: any) {
    const raw = await AsyncStorage.getItem(REVIEW_OUTBOX_KEY(userId));
    const list = raw ? JSON.parse(raw) : [];
    list.push(log);
    await AsyncStorage.setItem(REVIEW_OUTBOX_KEY(userId), JSON.stringify(list));
  },

  async flushOutbox(userId: string): Promise<number> {
    const raw = await AsyncStorage.getItem(REVIEW_OUTBOX_KEY(userId));
    const list = raw ? JSON.parse(raw) : [];
    if (!list.length) return 0;

    let ok = 0;
    const remaining: any[] = [];
    for (const item of list) {
      try {
        const { error } = await supabase.from('card_reviews').insert(item);
        if (error) throw error;
        ok += 1;
      } catch (e) {
        console.error('[FlashcardCache] flush error:', e);
        remaining.push(item);
      }
    }
    await AsyncStorage.setItem(REVIEW_OUTBOX_KEY(userId), JSON.stringify(remaining));
    return ok;
  },

  // --- CORE SRS BRIDGE ---
  async reviewCardSafe(userId: string, cardId: string, rating: Rating): Promise<SrsResult> {
    // 1. Load context
    const cached = await this.readState(userId, cardId);
    const prev = cached || {
      ease_factor: 2.5, interval_days: 0, repetitions: 0, lapses: 0,
      learning_step: 0, status: 'learning'
    };
    const settings = await SrsSettingsSvc.load(userId);

    // 2. Compute
    const result = applySrs(prev, rating, settings);

    // 3. Write-through Cache
    const newState = {
      ...prev,
      ...result,
      next_review: result.next_review.toISOString(),
      last_reviewed: new Date().toISOString(),
      _cachedAt: new Date().toISOString(),
    };
    await this._saveState(userId, cardId, newState);

    // 4. Outbox Review Log
    await this._enqueueReviewLog(userId, {
      user_id: userId,
      card_id: cardId,
      rating,
      quality: rating === 'again' ? 0 : rating === 'hard' ? 3 : rating === 'good' ? 4 : 5,
      prev_ef: prev.ease_factor,
      new_ef: result.ease_factor,
      prev_interval: prev.interval_days,
      new_interval: result.interval_days,
      learning_step: result.learning_step,
      reviewed_at: new Date().toISOString(),
    });

    // 5. Best-effort Supabase Sync
    supabase.from('user_cards').upsert({
      user_id: userId,
      card_id: cardId,
      ease_factor: result.ease_factor,
      interval_days: result.interval_days,
      interval_minutes: result.interval_minutes || 0,
      repetitions: result.repetitions,
      lapses: result.lapses,
      learning_step: result.learning_step,
      learning_status: result.status as LearningStatus,
      next_review: result.next_review.toISOString(),
      last_reviewed: new Date().toISOString(),
    }, { onConflict: 'user_id,card_id' }).then(() => this.flushOutbox(userId));

    return result;
  }
};
