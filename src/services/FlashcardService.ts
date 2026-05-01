import { supabase } from '../lib/supabase';
import { applySM2 } from './sm2';
import { FlashcardBranchService } from './FlashcardBranchService';
import { CardStatus, LearningStatus } from '../types/flashcards';

export type CardSource =
  | { kind: 'question'; question_id: string }
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

export interface CardState {
  status: CardStatus;
  learning_status: LearningStatus;
  next_review?: string | null;
  last_reviewed?: string | null;
  user_note?: string | null;
  repetitions?: number;
  interval_days?: number;
  ease_factor?: number;
  lapses?: number;
  last_quality?: number | null;
}

export class FlashcardSvc {
  // ============ SUBJECT/DECK READS (unchanged behaviour) ============
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
      .eq('user_id', userId).lte('next_review', new Date().toISOString())
      .order('next_review', { ascending: true }).limit(limit);
    if (error) throw error;
    return (data ?? []).map((d: any) => ({ ...d.cards, ...d, id: d.card_id }));
  }

  // ============ CREATE — generic ============
  static async createCard(userId: string, input: NewCardInput) {
    if (!input.front_text?.trim()) throw new Error('Front text required');
    if (!input.back_text?.trim()) throw new Error('Back text required');

    // Try to dedupe by source.question_id when present
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
          // legacy fields kept for backward compat:
          question_text: input.front_text,
          answer_text: input.back_text,
          question_id: input.question_id || null, // Link to source question
        })
        .select('id').single();
      if (error) throw error;
      card = data;
    }

    // Link in user_cards (idempotent)
    const { data: existing } = await supabase
      .from('user_cards').select('id').eq('user_id', userId).eq('card_id', card!.id).maybeSingle();
    
    if (!existing) {
      const { error } = await supabase.from('user_cards').insert({
        user_id: userId, card_id: card!.id,
        question_id: input.question_id || null, // Track source question
        ease_factor: 2.5, interval_days: 0, repetitions: 0, lapses: 0,
        next_review: new Date().toISOString(), 
        status: CardStatus.ACTIVE,
        learning_status: LearningStatus.NOT_STUDIED
      });
      if (error) throw error;
    }

    // --- NEW: Map to Branch Tree ---
    try {
      const branchId = await FlashcardBranchService.ensureDefaultBranch(
        userId, 
        input.subject || 'General', 
        input.section_group || 'General', 
        input.microtopic || 'General'
      );
      
      await supabase.from('flashcard_branch_cards').upsert({
        user_id: userId,
        branch_id: branchId,
        card_id: card!.id
      }, { onConflict: 'branch_id,card_id' });
    } catch (err) {
      console.error('[FlashcardSvc] Error mapping to branch:', err);
    }

    return card!.id;
  }

  // ============ CREATE FROM QUIZ QUESTION (FIX #1) ============
  // Front = Question stem + options (a) ... (d)
  // Back  = Correct answer line + Explanation markdown
  static async createFromQuestion(userId: string, q: any) {
    const opts = q.options ?? {};
    const optionLines = Object.entries(opts).map(([k, v]) => `(${k.toUpperCase()}) ${v}`).join('\n');
    const front_text = `${q.question_text || q.questionText || ''}\n\n${optionLines}`.trim();

    const correctKey = q.correct_answer || q.correctAnswer;
    const correctText = correctKey && opts[correctKey] ? `**Correct: (${correctKey.toUpperCase()})** ${opts[correctKey]}` : '';
    const explanation = q.explanation_markdown || q.explanation || '';
    const back_text = [correctText, explanation].filter(Boolean).join('\n\n');

    return this.createCard(userId, {
      front_text, back_text,
      subject: q.subject || 'General',
      section_group: q.section_group || 'General',
      microtopic: q.micro_topic || q.microtopic || 'General',
      card_type: 'qa',
      question_id: q.id,
      test_id: q.test_id || q.testId || q.tests?.id || 'manual',
      source: { kind: 'question', question_id: q.id },
    });
  }

  /** @deprecated use createFromQuestion */
  static async createFlashcardFromQuestion(userId: string, q: any) {
    return this.createFromQuestion(userId, q);
  }

  // ============ CREATE FROM NOTE BLOCK (Step 12) ============
  static async createFromNoteBlock(userId: string, params: {
    note_id: string;
    block_id?: string;
    front_text: string;
    back_text: string;
    subject?: string; section_group?: string; microtopic?: string;
    front_image_url?: string | null; back_image_url?: string | null;
  }) {
    return this.createCard(userId, {
      front_text: params.front_text,
      back_text: params.back_text,
      subject: params.subject, section_group: params.section_group, microtopic: params.microtopic,
      card_type: 'note_block',
      front_image_url: params.front_image_url, back_image_url: params.back_image_url,
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

  // ============ REVIEW (FIX #3 — proper SM-2) ============
  static async reviewCard(userId: string, cardId: string, quality: number) {
    const { data: cur, error } = await supabase
      .from('user_cards').select('*').eq('user_id', userId).eq('card_id', cardId).single();
    if (error) throw error;

    const sm = applySM2({
      ease_factor: Number(cur.ease_factor ?? 2.5),
      interval_days: Number(cur.interval_days ?? 0),
      repetitions: Number(cur.repetitions ?? 0),
      quality,
    }, Number(cur.lapses ?? 0));

    const newLapses = (cur.lapses ?? 0) + (sm.lapsed ? 1 : 0);

    const { error: upErr } = await supabase.from('user_cards').update({
      ease_factor: sm.ease_factor,
      interval_days: sm.interval_days,
      repetitions: sm.repetitions,
      next_review: sm.next_review.toISOString(),
      last_reviewed: new Date().toISOString(),
      last_quality: quality,
      lapses: newLapses,
      learning_status: sm.status as LearningStatus,
    }).eq('user_id', userId).eq('card_id', cardId);
    if (upErr) throw upErr;

    // Audit log
    await supabase.from('card_reviews').insert({
      user_id: userId, card_id: cardId,
      quality,
      prev_interval: cur.interval_days,
      new_interval: sm.interval_days,
      prev_ef: cur.ease_factor,
      new_ef: sm.ease_factor,
    });
    return sm;
  }

  // ============ MENU ACTION HELPERS ============
  private static async ensureUserHasCard(userId: string, cardId: string) {
    const { data, error } = await supabase
      .from('user_cards')
      .select('id, user_id, card_id, status')
      .eq('user_id', userId)
      .eq('card_id', cardId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Card not found for this user');
    return data;
  }

  private static async getCard(cardId: string) {
    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .eq('id', cardId)
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * If card is shared/non-manual, clone it first and repoint this user's user_cards row.
   * Prevents editing global question cards for all users.
   */
  private static async ensureEditableCardForUser(userId: string, cardId: string): Promise<string> {
    await this.ensureUserHasCard(userId, cardId);
    const card = await this.getCard(cardId);

    const isManual = card.card_type === 'manual' || String(card.question_id || '').startsWith('manual_');
    if (isManual) return cardId;

    const now = new Date().toISOString();
    const { data: clone, error: cloneErr } = await supabase
      .from('cards')
      .insert({
        question_id: `manual_copy_${Date.now()}`,
        test_id: 'manual',
        question_text: card.front_text || card.question_text || '',
        answer_text: card.back_text || card.answer_text || '',
        front_text: card.front_text || card.question_text || '',
        back_text: card.back_text || card.answer_text || '',
        front_image_url: card.front_image_url || null,
        back_image_url: card.back_image_url || null,
        subject: card.subject || 'General',
        section_group: card.section_group || 'General',
        microtopic: card.microtopic || 'General',
        provider: 'User',
        card_type: 'manual',
        source: {
          ...(card.source || {}),
          cloned_from: card.id,
          cloned_at: now,
        },
        explanation_markdown: card.explanation_markdown || card.back_text || card.answer_text || '',
      })
      .select('id')
      .single();

    if (cloneErr) throw cloneErr;

    const { error: linkErr } = await supabase
      .from('user_cards')
      .update({ card_id: clone.id, updated_at: now })
      .eq('user_id', userId)
      .eq('card_id', cardId);

    if (linkErr) throw linkErr;

    // IMPORTANT: Also update the branch mapping to point to the new clone
    try {
      const { error: brErr } = await supabase
        .from('flashcard_branch_cards')
        .update({ card_id: clone.id })
        .eq('card_id', cardId)
        .eq('user_id', userId);
      
      if (brErr) {
        console.warn('[FlashcardSvc] Branch mapping update failed (possibly missing user_id column):', brErr.message);
        // Fallback: If update failed, syncHierarchy will eventually pick it up, 
        // but we try to insert a new mapping just in case
        await supabase.from('flashcard_branch_cards').insert({
          card_id: clone.id,
          user_id: userId
        }).catch(() => {});
      }
    } catch (err) {
      console.error('[FlashcardSvc] Failed to update branch mapping during clone:', err);
    }

    return clone.id as string;
  }

  static async saveNote(userId: string, cardId: string, note: string) {
    await this.ensureUserHasCard(userId, cardId);
    const { error } = await supabase
      .from('user_cards')
      .update({
        user_note: note ?? '',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('card_id', cardId);
    if (error) throw error;
  }

  static async freezeCard(userId: string, cardId: string) {
    await this.ensureUserHasCard(userId, cardId);
    const { error } = await supabase
      .from('user_cards')
      .update({ status: 'frozen', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('card_id', cardId);
    if (error) throw error;
  }

  static async unfreezeCard(userId: string, cardId: string) {
    await this.ensureUserHasCard(userId, cardId);
    const { error } = await supabase
      .from('user_cards')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('card_id', cardId);
    if (error) throw error;
  }

  static async toggleFreeze(userId: string, cardId: string, currentStatus: string) {
    if (currentStatus === 'frozen') return this.unfreezeCard(userId, cardId);
    return this.freezeCard(userId, cardId);
  }

  static async updateCardForUser(userId: string, cardId: string, patch: Partial<NewCardInput>) {
    const editableCardId = await this.ensureEditableCardForUser(userId, cardId);
    await this.updateCard(editableCardId, patch);
    return editableCardId;
  }

  static async reverseCardForUser(userId: string, cardId: string) {
    const editableCardId = await this.ensureEditableCardForUser(userId, cardId);
    const card = await this.getCard(editableCardId);

    const front = card.front_text || card.question_text || '';
    const back = card.back_text || card.answer_text || '';
    const frontImg = card.front_image_url || null;
    const backImg = card.back_image_url || null;

    const { error } = await supabase
      .from('cards')
      .update({
        front_text: back,
        back_text: front,
        question_text: back,
        answer_text: front,
        front_image_url: backImg,
        back_image_url: frontImg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editableCardId);

    if (error) throw error;
    return editableCardId;
  }

  static async duplicateCardForUser(userId: string, cardId: string) {
    await this.ensureUserHasCard(userId, cardId);
    const card = await this.getCard(cardId);

    const { data: newCard, error: cardErr } = await supabase
      .from('cards')
      .insert({
        question_id: `manual_dup_${Date.now()}`,
        test_id: 'manual',
        question_text: card.front_text || card.question_text || '',
        answer_text: card.back_text || card.answer_text || '',
        front_text: card.front_text || card.question_text || '',
        back_text: card.back_text || card.answer_text || '',
        front_image_url: card.front_image_url || null,
        back_image_url: card.back_image_url || null,
        subject: card.subject || 'General',
        section_group: card.section_group || 'General',
        microtopic: card.microtopic || 'General',
        provider: 'User',
        card_type: 'manual',
        source: {
          ...(card.source || {}),
          duplicated_from: card.id,
        },
        explanation_markdown: card.explanation_markdown || '',
      })
      .select('id')
      .single();

    if (cardErr) throw cardErr;

    const { error: userCardErr } = await supabase
      .from('user_cards')
      .insert({
        user_id: userId,
        card_id: newCard.id,
        status: 'active',
        learning_status: 'not_studied',
        repetitions: 0,
        interval_days: 0,
        ease_factor: 2.5,
        next_review: new Date().toISOString(),
        user_note: '',
      });

    if (userCardErr) throw userCardErr;
    return newCard.id as string;
  }

  static async moveCardForUser(
    userId: string,
    cardId: string,
    target: { subject: string; section_group: string; microtopic: string }
  ) {
    const editableCardId = await this.ensureEditableCardForUser(userId, cardId);

    // 1. Update Card Metadata
    const { error } = await supabase
      .from('cards')
      .update({
        subject: target.subject.trim(),
        section_group: target.section_group.trim(),
        microtopic: target.microtopic.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', editableCardId);

    if (error) throw error;

    // 2. Update Branch Mapping
    try {
      const branchId = await FlashcardBranchService.ensureDefaultBranch(
        userId,
        target.subject,
        target.section_group,
        target.microtopic
      );

      // We use upsert on (card_id, user_id) if we had that unique constraint, 
      // but here we check for card_id and update it to the new branch_id.
      // Since a card should only be in one branch for a user:
      await supabase
        .from('flashcard_branch_cards')
        .delete()
        .eq('card_id', editableCardId)
        .eq('user_id', userId);

      await supabase
        .from('flashcard_branch_cards')
        .insert({
          user_id: userId,
          card_id: editableCardId,
          branch_id: branchId
        });
    } catch (err) {
      console.error('[FlashcardSvc] Failed to update branch mapping during move:', err);
      // We don't throw here as the card metadata is already updated
    }

    return editableCardId;
  }

  static async softDeleteCardForUser(userId: string, cardId: string) {
    await this.ensureUserHasCard(userId, cardId);
    const { error } = await supabase
      .from('user_cards')
      .update({ status: 'deleted', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('card_id', cardId);
    if (error) throw error;
  }

  static async restoreDeletedCardForUser(userId: string, cardId: string) {
    const { error } = await supabase
      .from('user_cards')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('card_id', cardId)
      .eq('status', 'deleted');
    if (error) throw error;
  }

  static async getLearningHistory(userId: string, cardId: string, limit = 30, offset = 0) {
    const to = offset + limit - 1;
    const { data, error } = await supabase
      .from('card_reviews')
      .select('id, reviewed_at, quality, prev_interval, new_interval, prev_ef, new_ef')
      .eq('user_id', userId)
      .eq('card_id', cardId)
      .order('reviewed_at', { ascending: false })
      .range(offset, to);

    if (error) throw error;
    return data || [];
  }

  static async getLearningHistorySummary(userId: string, cardId: string) {
    await this.ensureUserHasCard(userId, cardId);

    const { data: cardState, error: stateErr } = await supabase
      .from('user_cards')
      .select('created_at, next_review, learning_status, interval_days, repetitions, ease_factor')
      .eq('user_id', userId)
      .eq('card_id', cardId)
      .single();

    if (stateErr) throw stateErr;

    const reviews = await this.getLearningHistory(userId, cardId, 300, 0);

    return {
      created_at: cardState.created_at,
      next_review: cardState.next_review,
      learning_status: cardState.learning_status,
      interval_days: Number(cardState.interval_days ?? 0),
      repetitions: Number(cardState.repetitions ?? 0),
      ease_factor: Number(cardState.ease_factor ?? 2.5),
      avg_review_duration: null,
      reviews,
    };
  }

  static async resetCardProgressForUser(userId: string, cardId: string) {
    await this.ensureUserHasCard(userId, cardId);

    const now = new Date().toISOString();
    const { error: resetErr } = await supabase
      .from('user_cards')
      .update({
        status: 'active',
        learning_status: 'not_studied',
        repetitions: 0,
        interval_days: 0,
        ease_factor: 2.5,
        next_review: now,
        last_reviewed: null,
        last_quality: null,
        lapses: 0,
        again_count: 0,
        updated_at: now,
      })
      .eq('user_id', userId)
      .eq('card_id', cardId);

    if (resetErr) throw resetErr;

    const { error: historyErr } = await supabase
      .from('card_reviews')
      .delete()
      .eq('user_id', userId)
      .eq('card_id', cardId);

    if (historyErr) throw historyErr;
  }

  /** @deprecated  Map old performance arg → quality. */
  static async updateCardProgress(userId: string, cardId: string, performance: number) {
    return this.reviewCard(userId, cardId, performance);
  }
}
