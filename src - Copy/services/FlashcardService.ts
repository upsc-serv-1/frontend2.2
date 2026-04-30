import { supabase } from '../lib/supabase';

export interface SM2Result {
  repetitions: number;
  interval_days: number;
  easeFactor: number;
  nextReview: Date;
}

export interface CardState {
  id: string;
  user_id: string;
  card_id: string;
  status: 'active' | 'frozen';
  learning_status: 'not_studied' | 'learning' | 'mastered';
  repetitions: number;
  interval_days: number;
  ease_factor: number;
  next_review: string;
  last_reviewed: string;
  again_count: number;
  user_note: string;
}

class FlashcardService {
  /**
   * SM-2 Algorithm Implementation
   * @param score 0-5 (Again=0, Hard=3, Good=4, Easy=5)
   */
  calculateSM2(score: number, repetitions: number, interval_days: number, easeFactor: number): SM2Result {
    let nextRepetitions = repetitions;
    let nextInterval = interval_days;
    let nextEaseFactor = easeFactor;

    if (score < 3) {
      // "Again" / Forgot
      nextRepetitions = 0;
      nextInterval = 1;
    } else {
      if (nextRepetitions === 0) {
        nextInterval = 1;
      } else if (nextRepetitions === 1) {
        nextInterval = 6;
      } else {
        nextInterval = Math.round(interval_days * easeFactor);
      }
      nextRepetitions += 1;
    }

    // Update Ease Factor
    nextEaseFactor = easeFactor + (0.1 - (5 - score) * (0.08 + (5 - score) * 0.02));
    if (nextEaseFactor < 1.3) nextEaseFactor = 1.3;

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + nextInterval);

    return {
      repetitions: nextRepetitions,
      interval_days: nextInterval,
      easeFactor: nextEaseFactor,
      nextReview
    };
  }

  async createFlashcardFromQuestion(userId: string, q: any) {
    try {
      // 1. Find or create the card entry
      let { data: card, error: findError } = await supabase
        .from('cards')
        .select('id')
        .eq('question_id', q.id)
        .maybeSingle();

      if (!card) {
        const { data: newCard, error: insertError } = await supabase
          .from('cards')
          .insert({
            question_id: q.id,
            test_id: q.test_id || 'manual',
            question_text: q.question_text,
            answer_text: q.explanation_markdown || '',
            correct_answer: q.correct_answer,
            subject: q.subject,
            section_group: q.section_group,
            microtopic: q.micro_topic,
            provider: q.provider || 'UPSC',
            explanation_markdown: q.explanation_markdown || ''
          })
          .select('id')
          .single();

        if (insertError) throw insertError;
        card = newCard;
      }

      if (!card) throw new Error("Failed to create card entry");

      // 2. Link to user_cards
      const { error: userCardError } = await supabase
        .from('user_cards')
        .upsert({
          user_id: userId,
          card_id: card.id,
          status: 'active',
          learning_status: 'not_studied',
          next_review: new Date().toISOString()
        }, { onConflict: 'user_id,card_id' });

      if (userCardError) throw userCardError;
      return card;
    } catch (err) {
      console.error("Flashcard creation failed:", err);
      throw err;
    }
  }

  async createFlashcardFromNote(userId: string, note: any) {
    try {
      const noteId = `note_${note.id}`;
      
      // 1. Create the card entry (notes always create new card or update by noteId)
      const { data: card, error: cardError } = await supabase
        .from('cards')
        .upsert({
          question_id: noteId,
          test_id: 'notebook',
          question_text: note.title || 'Note Flashcard',
          answer_text: note.content || '',
          subject: note.subject || 'General',
          explanation_markdown: note.content || ''
        }, { onConflict: 'question_id' })
        .select('id')
        .single();

      if (cardError) throw cardError;

      // 2. Link to user_cards
      const { error: userCardError } = await supabase
        .from('user_cards')
        .upsert({
          user_id: userId,
          card_id: card.id,
          status: 'active',
          learning_status: 'not_studied',
          next_review: new Date().toISOString()
        }, { onConflict: 'user_id,card_id' });

      if (userCardError) throw userCardError;
      return card;
    } catch (err) {
      console.error("Flashcard from note failed:", err);
      throw err;
    }
  }

  async updateCardProgress(userId: string, cardId: string, score: number, currentState: Partial<CardState>) {
    const { repetitions = 0, interval_days = 0, ease_factor = 2.5 } = currentState;
    
    const result = this.calculateSM2(
      score, 
      repetitions, 
      interval_days, 
      ease_factor
    );

    const learningStatus = score === 5 ? 'mastered' : (result.repetitions > 3 ? 'mastered' : 'learning');

    const update = {
      user_id: userId,
      card_id: cardId,
      repetitions: result.repetitions,
      interval_days: result.interval_days,
      ease_factor: result.easeFactor,
      next_review: result.nextReview.toISOString(),
      last_reviewed: new Date().toISOString(),
      learning_status: learningStatus,
      again_count: (currentState.again_count || 0) + (score < 3 ? 1 : 0),
      status: 'active',
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('user_cards')
      .upsert(update, { onConflict: 'user_id,card_id' });

    if (error) throw error;
    return result;
  }

  async freezeCard(userId: string, cardId: string) {
    const { error } = await supabase
      .from('user_cards')
      .upsert({ 
        user_id: userId, 
        card_id: cardId, 
        status: 'frozen',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,card_id' });
    if (error) throw error;
  }

  async unfreezeCard(userId: string, cardId: string) {
    const { error } = await supabase
      .from('user_cards')
      .upsert({ 
        user_id: userId, 
        card_id: cardId, 
        status: 'active',
        repetitions: 0,
        interval_days: 0,
        ease_factor: 2.5,
        next_review: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,card_id' });
    if (error) throw error;
  }

  async saveNote(userId: string, cardId: string, note: string) {
    const { error } = await supabase
      .from('user_cards')
      .upsert({ 
        user_id: userId, 
        card_id: cardId, 
        user_note: note,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,card_id' });
    if (error) throw error;
  }
}

export const FlashcardSvc = new FlashcardService();
