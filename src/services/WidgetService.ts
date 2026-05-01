import { supabase } from '../lib/supabase';

export const ALL_WIDGET_KEYS = [
  'daily_goal', 'exam_countdown', 'questions_today', 'study_time_today',
  'weekly_streak', 'accuracy_trend', 'correct_incorrect', 'speed_meter',
  'due_cards', 'mastery_ring', 'pyq_coverage', 'recent_notes',
  'tagged_count', 'quick_practice', 'last_test', 'test_scores',
  'study_heatmap'
];

export type Widget = {
  id: string;
  widget_key: string;
  position: number;
  is_archived: boolean;
  size: 'half' | 'full';
};

const DEFAULT_FULL = ['study_heatmap', 'test_scores', 'recent_notes', 'accuracy_trend'];

class WidgetSvcImpl {
  async ensureSeeded(userId: string) {
    const { data } = await supabase
      .from('user_widgets').select('widget_key').eq('user_id', userId);
    const have = new Set((data || []).map(r => r.widget_key));
    const missing = ALL_WIDGET_KEYS.filter(k => !have.has(k));
    if (!missing.length) return;
    const rows = missing.map((k, i) => ({
      user_id: userId,
      widget_key: k,
      position: (data?.length || 0) + i,
      is_archived: false,
      size: DEFAULT_FULL.includes(k) ? 'full' : 'half',
    }));
    await supabase.from('user_widgets').insert(rows);
  }

  async list(userId: string): Promise<Widget[]> {
    await this.ensureSeeded(userId);
    const { data, error } = await supabase
      .from('user_widgets').select('*').eq('user_id', userId)
      .order('position', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async archive(userId: string, id: string) {
    await supabase.from('user_widgets').update({ is_archived: true })
      .eq('id', id).eq('user_id', userId);
  }

  async setSize(userId: string, id: string, size: 'half' | 'full') {
    await supabase.from('user_widgets').update({ size })
      .eq('id', id).eq('user_id', userId);
  }

  async restore(userId: string, id: string) {
    await supabase.from('user_widgets').update({ is_archived: false })
      .eq('id', id).eq('user_id', userId);
  }

  async reorder(userId: string, orderedIds: string[]) {
    // Batch update positions
    const updates = orderedIds.map((id, idx) =>
      supabase.from('user_widgets').update({ position: idx })
        .eq('id', id).eq('user_id', userId)
    );
    await Promise.all(updates);
  }

  getAvailableWidgets() {
    return ALL_WIDGET_KEYS;
  }
}

export const WidgetService = new WidgetSvcImpl();
