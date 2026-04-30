import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashcardSvc, CardState } from './FlashcardService';

const SESSION_KEY = (uid: string, mt: string) => `fc.session.${uid}.${mt}`;
const STATE_KEY = (uid: string, cid: string) => `fc.state.${uid}.${cid}`;
const QUEUE_KEY = (uid: string) => `fc.queue.${uid}`;

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

  async cacheState(userId: string, cardId: string, state: Partial<CardState>) {
    await AsyncStorage.setItem(
      STATE_KEY(userId, cardId),
      JSON.stringify({ ...state, _cachedAt: new Date().toISOString() })
    );
  },

  async readState(userId: string, cardId: string) {
    const raw = await AsyncStorage.getItem(STATE_KEY(userId, cardId));
    return raw ? JSON.parse(raw) : null;
  },

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
        ok += 1;
      } catch {
        remaining.push(item);
      }
    }

    await AsyncStorage.setItem(QUEUE_KEY(userId), JSON.stringify(remaining));
    return ok;
  },

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
    } catch {
      await this.enqueueReview(userId, { cardId, quality, ts: new Date().toISOString() });

      const cached = (await this.readState(userId, cardId)) || {};
      const interval = Math.max(1, (cached.interval_days || 1) * 2);
      const next = new Date();
      next.setDate(next.getDate() + interval);

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
