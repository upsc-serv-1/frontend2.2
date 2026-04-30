import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import type { WidgetData } from '../../hooks/useWidgetData';
import { WidgetConfig } from '../../services/WidgetService';
import {
  DailyGoalWidget, ExamCountdownWidget, QuestionsTodayWidget,
  StudyTimeWidget, WeeklyActivityWidget, AccuracyTrendWidget,
  TodayScoreWidget, WeakestSubjectWidget, SpeedMeterWidget,
} from './CoreWidgets';
import {
  DueCardsWidget, MasteryRingWidget, PYQCoverageWidget,
  RecentNotesWidget, TaggedCountWidget, QuickPracticeWidget,
  LastTestWidget, TestScoresWidget,
} from '../ExtraWidgets';
import { WIDGET_REGISTRY } from '../../services/WidgetService';

interface Props {
  activeWidgets: string[];
  data: WidgetData;
  config: WidgetConfig;
  colors: any;
  isEditMode: boolean;
  onRemove: (id: string) => void;
}

function renderWidget(id: string, data: WidgetData, config: WidgetConfig, colors: any) {
  switch (id) {
    case 'daily_goal':       return <DailyGoalWidget data={data} colors={colors} dailyGoal={config.dailyGoal} />;
    case 'exam_countdown':   return <ExamCountdownWidget colors={colors} examDate={config.examDate} />;
    case 'questions_today':  return <QuestionsTodayWidget data={data} colors={colors} />;
    case 'study_time_today': return <StudyTimeWidget data={data} colors={colors} />;
    case 'weekly_streak':    return <WeeklyActivityWidget data={data} colors={colors} />;
    case 'accuracy_trend':   return <AccuracyTrendWidget data={data} colors={colors} />;
    case 'correct_incorrect':return <TodayScoreWidget data={data} colors={colors} />;
    case 'weakest_subject':  return <WeakestSubjectWidget data={data} colors={colors} />;
    case 'speed_meter':      return <SpeedMeterWidget data={data} colors={colors} />;
    case 'due_cards':        return <DueCardsWidget data={data} colors={colors} />;
    case 'mastery_ring':     return <MasteryRingWidget data={data} colors={colors} />;
    case 'pyq_coverage':     return <PYQCoverageWidget data={data} colors={colors} />;
    case 'recent_notes':     return <RecentNotesWidget data={data} colors={colors} />;
    case 'tagged_count':     return <TaggedCountWidget data={data} colors={colors} />;
    case 'quick_practice':   return <QuickPracticeWidget colors={colors} />;
    case 'last_test':        return <LastTestWidget data={data} colors={colors} />;
    case 'test_scores':      return <TestScoresWidget data={data} colors={colors} />;
    default: return null;
  }
}

export function WidgetGrid({ activeWidgets, data, config, colors, isEditMode, onRemove }: Props) {
  // Build rows: full-width widgets take a row, half-width pair up
  const rows: { type: 'full' | 'pair'; ids: string[] }[] = [];
  let halfBuffer: string[] = [];

  activeWidgets.forEach(id => {
    const def = WIDGET_REGISTRY.find(w => w.id === id);
    if (!def) return;
    if (def.size === 'full') {
      if (halfBuffer.length > 0) {
        rows.push({ type: 'pair', ids: [...halfBuffer] });
        halfBuffer = [];
      }
      rows.push({ type: 'full', ids: [id] });
    } else {
      halfBuffer.push(id);
      if (halfBuffer.length === 2) {
        rows.push({ type: 'pair', ids: [...halfBuffer] });
        halfBuffer = [];
      }
    }
  });
  if (halfBuffer.length > 0) rows.push({ type: 'pair', ids: [...halfBuffer] });

  return (
    <View style={{ gap: 0 }}>
      {rows.map((row, ri) => (
        <View key={ri} style={row.type === 'pair' ? rs.pairRow : undefined}>
          {row.ids.map(id => (
            <View key={id} style={row.type === 'pair' ? { width: '48%' } : undefined}>
              {isEditMode && (
                <TouchableOpacity style={rs.removeBtn} onPress={() => onRemove(id)}>
                  <X color="#fff" size={14} />
                </TouchableOpacity>
              )}
              {renderWidget(id, data, config, colors)}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const rs = StyleSheet.create({
  pairRow: { flexDirection: 'row', justifyContent: 'space-between' },
  removeBtn: {
    position: 'absolute', top: 4, right: 4, zIndex: 10,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center',
  },
});
