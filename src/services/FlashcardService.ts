import { supabase } from '../lib/supabase';
import { applySM2 } from './sm2';

export type CardSource =
  | { kind: 'question'; question_id: string; options?: Record<string, string> }
  | { kind: 'note'; note_id: string; block_id?: string }
  | { kind: 'manual' };

export interface NewCardInput {
  front_text: string;
  back_text: string;
  front_image_url?: string | null;
  back_image_url?: string | null;
  subject?: string;
  section_group?: string;
  microtopic?: string;
  card_type?: 'qa' | 'note_block' | 'manual';
  source?: CardSource;
  question_id?: string | null;
  test_id?: string | null;
}

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

export class FlashcardSvc {
  // ============ SUBJECT/DECK READS ============
  static async getSubjects(userId: string) {
    const { data, error } = await supabase
      .from('user_cards').select('cards(subject)').eq('user_id', userId);
    if (error) throw error;
    return Array.from(new Set((data ?? []).map((d: any) => d.cards?.subject).filter(Boolean))).sort();
  }

  static async getDecks(userId: string, subject: string) {
    const { data, error } = await supabase
      .from('user_cards').select('cards(section_group, microtopic)')
      .eq('user_id', userId).eq('cards.subject', subject);
    if (error) throw error;
    const decks: Record<string, string[]> = {};
    (data ?? []).forEach((d: any) => {
      const sg = d.cards?.section_group || 'General';
      const mt = d.cards?.microtopic || 'General';
      if (!decks[sg]) decks[sg] = [];
      if (!decks[sg].includes(mt)) decks[sg].push(mt);
    });
    return decks;
  }

  static async getCards(userId: string, subject: string, section: string, microtopic: string) {
    const { data, error } = await supabase
      .from('user_cards').select('*, cards!inner(*)')
      .eq('user_id', userId).eq('cards.subject', subject)
      .eq('cards.section_group', section).eq('cards.microtopic', microtopic);
    if (error) throw error;
    return (data ?? []).map((d: any) => ({ ...d.cards, ...d, id: d.card_id }));
  }

  static async getDueCards(userId: string, limit = 50) {
    const { data, error } = await supabase
      .from('user_cards').select('*, cards!inner(*)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .lte('next_review', new Date().toISOString())
      .order('next_review', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((d: any) => ({ ...d.cards, ...d, id: d.card_id }));
  }

  // ============ CREATE — generic ============
  static async createCard(userId: string, input: NewCardInput) {
    if (!input.front_text?.trim()) throw new Error('Front text required');
    if (!input.back_text?.trim()) throw new Error('Back text required');

    let card: { id: string } | null = null;
    if (input.question_id) {
      const { data } = await supabase.from('cards').select('id').eq('question_id', input.question_id).maybeSingle();
      if (data) card = data;
    }

    if (!card) {
      const { data, error } = await supabase
        .from('cards')
        .insert({
          question_id: input.question_id || `manual_${Date.now()}`,
          subject: input.subject || 'General',
          section_group: input.section_group || 'General',
          microtopic: input.microtopic || 'General',
          front_text: input.front_text,
          back_text: input.back_text,
          front_image_url: input.front_image_url || null,
          back_image_url: input.back_image_url || null,
          card_type: input.card_type || 'manual',
          source: input.source || {},
          test_id: input.test_id || 'manual',
          question_text: input.front_text,
          answer_text: input.back_text,
        })
        .select('id')
        .single();
      if (error) throw error;
      card = data;
    }

    await this.linkUserCard(userId, card!.id);
    return card!.id;
  }

  // ============ CREATE FROM QUIZ QUESTION (req #1, #2, #3) ============
  static async createFromQuestion(userId: string, q: any) {
    const opts = q.options ?? {};
    const stmtLines = Array.isArray(q.statement_lines) ? q.statement_lines.join('\n') : '';
    const optionLines = Object.entries(opts)
      .map(([k, v]) => `(${k.toUpperCase()}) ${v}`)
      .join('\n');

    const front_text = [q.question_text || q.questionText || '', stmtLines, optionLines]
      .filter(Boolean)
      .join('\n\n')
      .trim();

    const correctKey = q.correct_answer || q.correctAnswer;
    const correctText = correctKey && opts[correctKey]
      ? `**Correct: (${correctKey.toUpperCase()})** ${opts[correctKey]}`
      : '';
    const explanation = q.explanation_markdown || q.explanation || '';
    const back_text = [correctText, explanation].filter(Boolean).join('\n\n');

    const instituteSrc: InstituteSource = {
      institute: q.institute || q.tests?.institute || q.provider || 'Unknown',
      year: q.exam_year || q.year,
      test_id: q.test_id || q.testId || q.tests?.id,
      correct: correctKey,
    };

    let card: { id: string; institutes?: any[]; merged_from?: any[] } | null = null;
    if (q.id) {
      const { data } = await supabase
        .from('cards')
        .select('id, institutes, merged_from')
        .eq('question_id', q.id)
        .maybeSingle();
      if (data) card = data as any;
    }

    if (card) {
      const existing = Array.isArray(card.institutes) ? card.institutes : [];
      const alreadyPresent = existing.some((i: InstituteSource) =>
        i.institute === instituteSrc.institute && i.year === instituteSrc.year
      );
      if (!alreadyPresent) {
        await supabase.from('cards').update({
          institutes: [...existing, instituteSrc],
          merged_from: [...(card.merged_from || []), q.id],
        }).eq('id', card.id);
      }
      await this.linkUserCard(userId, card.id);
      return card.id;
    }

    const { data: inserted, error } = await supabase
      .from('cards')
      .insert({
        question_id: q.id || `manual_${Date.now()}`,
        subject: q.subject || 'General',
        section_group: q.section_group || 'General',
        microtopic: q.micro_topic || q.microtopic || 'General',
        front_text,
        back_text,
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
      .select('id')
      .single();

    if (error) throw error;
    await this.linkUserCard(userId, inserted.id);
    return inserted.id;
  }

  /** @deprecated use createFromQuestion */
  static async createFlashcardFromQuestion(userId: string, q: any) {
    return this.createFromQuestion(userId, q);
  }

  private static async linkUserCard(userId: string, cardId: string) {
    const { data: existing } = await supabase
      .from('user_cards')
      .select('id')
      .eq('user_id', userId)
      .eq('card_id', cardId)
      .maybeSingle();

    if (existing) return;

    const { error } = await supabase.from('user_cards').insert({
      user_id: userId,
      card_id: cardId,
      ease_factor: 2.5,
      interval_days: 0,
      repetitions: 0,
      lapses: 0,
      next_review: new Date().toISOString(),
      status: 'active',
      learning_status: 'not_studied',
      user_note: '',
      times_seen: 0,
    });

    if (error) throw error;
  }

  // ============ CREATE FROM NOTE BLOCK ============
  static async createFromNoteBlock(userId: string, params: {
    note_id: string;
    block_id?: string;
    front_text: string;
    back_text: string;
    subject?: string;
    section_group?: string;
    microtopic?: string;
    front_image_url?: string | null;
    back_image_url?: string | null;
  }) {
    return this.createCard(userId, {
      front_text: params.front_text,
      back_text: params.back_text,
      subject: params.subject,
      section_group: params.section_group,
      microtopic: params.microtopic,
      card_type: 'note_block',
      front_image_url: params.front_image_url,
      back_image_url: params.back_image_url,
      source: { kind: 'note', note_id: params.note_id, block_id: params.block_id },
    });
  }

  // ============ EDIT / DELETE ============
  static async updateCard(cardId: string, patch: Partial<NewCardInput>) {
    const updateData: any = { ...patch, updated_at: new Date().toISOString() };
    if (patch.front_text) updateData.question_text = patch.front_text;
    if (patch.back_text) updateData.answer_text = patch.back_text;
    const { error } = await supabase.from('cards').update(updateData).eq('id', cardId);
    if (error) throw error;
  }

  static async deleteCardForUser(userId: string, cardId: string) {
    const { error } = await supabase.from('user_cards').delete().eq('user_id', userId).eq('card_id', cardId);
    if (error) throw error;
  }

  // ============ REVIEW (SM-2 + bucket updates) ============
  static async reviewCard(userId: string, cardId: string, quality: number) {
    const { data: existing, error } = await supabase
      .from('user_cards')
      .select('*')
      .eq('user_id', userId)
      .eq('card_id', cardId)
      .maybeSingle();

    if (error) throw error;

    let cur = existing;
    if (!cur) {
      await this.linkUserCard(userId, cardId);
      const { data: seeded, error: seedErr } = await supabase
        .from('user_cards')
        .select('*')
        .eq('user_id', userId)
        .eq('card_id', cardId)
        .single();
      if (seedErr) throw seedErr;
      cur = seeded;
    }

    const sm = applySM2(
      {
        ease_factor: Number(cur.ease_factor ?? 2.5),
        interval_days: Number(cur.interval_days ?? 0),
        repetitions: Number(cur.repetitions ?? 0),
        quality,
      },
      Number(cur.lapses ?? 0)
    );

    const newLapses = (cur.lapses ?? 0) + (sm.lapsed ? 1 : 0);

    const { error: upErr } = await supabase
      .from('user_cards')
      .update({
        ease_factor: sm.ease_factor,
        interval_days: sm.interval_days,
        repetitions: sm.repetitions,
        next_review: sm.next_review.toISOString(),
        last_reviewed: new Date().toISOString(),
        last_quality: quality,
        lapses: newLapses,
        status: 'active',
        learning_status: sm.status,
        times_seen: Number(cur.times_seen ?? 0) + 1,
        client_updated_at: new Date().toISOString(),
        dirty: false,
      })
      .eq('user_id', userId)
      .eq('card_id', cardId);

    if (upErr) throw upErr;

    await supabase.from('card_reviews').insert({
      user_id: userId,
      card_id: cardId,
      quality,
      prev_interval: cur.interval_days,
      new_interval: sm.interval_days,
      prev_ef: cur.ease_factor,
      new_ef: sm.ease_factor,
    });

    return sm;
  }

  // ============ FREEZE / UNFREEZE ============
  static async freezeCard(userId: string, cardId: string) {
    const { error } = await supabase
      .from('user_cards')
      .update({ status: 'frozen', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('card_id', cardId);
    if (error) throw error;
  }

  static async unfreezeCard(userId: string, cardId: string) {
    const { error } = await supabase
      .from('user_cards')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('card_id', cardId);
    if (error) throw error;
  }

  // ============ PERSONAL NOTE ============
  static async saveNote(userId: string, cardId: string, note: string) {
    const { error } = await supabase
      .from('user_cards')
      .update({ user_note: note, updated_at: new Date().toISOString(), client_updated_at: new Date().toISOString(), dirty: true })
      .eq('user_id', userId)
      .eq('card_id', cardId);
    if (error) throw error;
  }

  // ============ DECK SUMMARY ============
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

    return data ?? {
      new_count: 0,
      learning_count: 0,
      mastered_count: 0,
      due_count: 0,
      total_count: 0,
    };
  }

  // ============ CARD LIST WITH PREVIEW ============
  static async listCardsWithProgress(userId: string, subject: string, section: string, microtopic: string) {
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

  // ============ DUE CARDS WITH DAY LABEL ============
  static async listDueWithDays(userId: string, withinDays = 7) {
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + withinDays);

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
        ...d.cards,
        ...d,
        id: d.card_id,
        days_until_due: diff <= 0 ? 0 : diff,
        due_label: diff <= 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `${diff}d`,
      };
    });
  }

  /** @deprecated  Map old performance arg → quality. */
  static async updateCardProgress(userId: string, cardId: string, performance: number) {
    return this.reviewCard(userId, cardId, performance);
  }
}
