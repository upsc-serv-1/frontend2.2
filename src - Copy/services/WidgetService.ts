import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Widget Registry ─────────────────────────────────────────────
export interface WidgetDef {
  id: string;
  title: string;
  category: string;
  size: 'half' | 'full';
  description: string;
}

export const WIDGET_REGISTRY: WidgetDef[] = [
  { id: 'daily_goal', title: 'Daily Goal Ring', category: 'Progress', size: 'half', description: 'Track your daily question target' },
  { id: 'exam_countdown', title: 'Exam Countdown', category: 'Progress', size: 'half', description: 'Days until your target exam' },
  { id: 'questions_today', title: 'Questions Today', category: 'Progress', size: 'half', description: 'Questions attempted today' },
  { id: 'study_time_today', title: 'Study Time', category: 'Progress', size: 'half', description: 'Total time studied today' },
  { id: 'weekly_streak', title: 'Weekly Activity', category: 'Progress', size: 'full', description: '7-day activity heatmap' },
  { id: 'accuracy_trend', title: 'Accuracy Trend', category: 'Analytics', size: 'full', description: '7-day accuracy sparkline' },
  { id: 'correct_incorrect', title: "Today's Score", category: 'Analytics', size: 'half', description: 'Correct vs incorrect today' },
  { id: 'weakest_subject', title: 'Weakest Subject', category: 'Analytics', size: 'full', description: 'Subject needing most attention' },
  { id: 'speed_meter', title: 'Avg Speed', category: 'Analytics', size: 'half', description: 'Average time per question' },
  { id: 'due_cards', title: 'Due Flashcards', category: 'Flashcards', size: 'half', description: 'Cards due for review' },
  { id: 'mastery_ring', title: 'Card Mastery', category: 'Flashcards', size: 'half', description: 'Learning vs mastered cards' },
  { id: 'pyq_coverage', title: 'PYQ Year Coverage', category: 'PYQ', size: 'full', description: 'Which PYQ years you\'ve covered' },
  { id: 'recent_notes', title: 'Recent Notes', category: 'Notes', size: 'full', description: 'Your latest notebooks' },
  { id: 'tagged_count', title: 'Tagged Questions', category: 'Tags', size: 'half', description: 'Questions you\'ve tagged' },
  { id: 'quick_practice', title: 'Quick Practice', category: 'Arena', size: 'full', description: 'One-tap practice shortcuts' },
  { id: 'last_test', title: 'Last Test', category: 'Arena', size: 'full', description: 'Your most recent test result' },
  { id: 'test_scores', title: 'Score Timeline', category: 'Arena', size: 'full', description: 'Recent test score chart' },
];

// ─── Config ──────────────────────────────────────────────────────
const WIDGET_CONFIG_KEY = '@widget_config';

export interface WidgetConfig {
  activeWidgets: string[];
  examDate: string | null; // ISO date
  dailyGoal: number;
}

const DEFAULT_CONFIG: WidgetConfig = {
  activeWidgets: [
    'daily_goal', 'exam_countdown', 'questions_today', 'study_time_today',
    'accuracy_trend', 'quick_practice', 'due_cards', 'correct_incorrect',
  ],
  examDate: null,
  dailyGoal: 50,
};

class WidgetServiceClass {
  async getConfig(): Promise<WidgetConfig> {
    try {
      const raw = await AsyncStorage.getItem(WIDGET_CONFIG_KEY);
      if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {}
    return { ...DEFAULT_CONFIG };
  }

  async saveConfig(config: WidgetConfig) {
    await AsyncStorage.setItem(WIDGET_CONFIG_KEY, JSON.stringify(config));
  }

  async addWidget(widgetId: string) {
    const config = await this.getConfig();
    if (!config.activeWidgets.includes(widgetId)) {
      config.activeWidgets.push(widgetId);
      await this.saveConfig(config);
    }
    return config;
  }

  async removeWidget(widgetId: string) {
    const config = await this.getConfig();
    config.activeWidgets = config.activeWidgets.filter(id => id !== widgetId);
    await this.saveConfig(config);
    return config;
  }

  async setExamDate(date: string | null) {
    const config = await this.getConfig();
    config.examDate = date;
    await this.saveConfig(config);
  }

  async setDailyGoal(goal: number) {
    const config = await this.getConfig();
    config.dailyGoal = goal;
    await this.saveConfig(config);
  }

  getAvailableWidgets(activeIds: string[]): WidgetDef[] {
    return WIDGET_REGISTRY.filter(w => !activeIds.includes(w.id));
  }
}

export const WidgetService = new WidgetServiceClass();
