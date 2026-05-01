import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal, Pressable, Vibration, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { TrendingUp, Target, Flame, BookOpen, BarChart3, ChevronRight, Layout, Play, Clock, RotateCcw, Zap, History, Plus, GripVertical, Sliders, X, Check, Maximize2 } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { radius, spacing } from '../../src/theme';
import { cacheGet, cacheSet } from '../../src/lib/cache';
import { useTheme } from '../../src/context/ThemeContext';
import { PageWrapper } from '../../src/components/PageWrapper';
import { SyllabusService } from '../../src/services/SyllabusService';
import { MICRO_SYLLABUS, OPTIONAL_SUBJECTS } from '../../src/data/syllabus';
import { Alert } from 'react-native';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import { WidgetService, Widget } from '../../src/services/WidgetService';
import { useWidgetData } from '../../src/hooks/useWidgetData';
import { WidgetRenderer } from '../../src/components/widgets/WidgetRenderer';
import { GlobalSearchBar } from '../../src/components/GlobalSearchBar';

type Stats = { 
  attempts: number; 
  accuracy: number; 
  dueCards: number; 
  totalNotes: number; 
  streak: number; 
  syllabusPercent: number;
  subjectProgress: { label: string; progress: number; color: string }[];
};

export default function Home() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const userId = session?.user.id;
  const name = (session?.user.user_metadata as any)?.display_name || session?.user?.email?.split('@')[0] || 'Aspirant';
  const [stats, setStats] = useState<Stats>({ 
    attempts: 0, accuracy: 0, dueCards: 0, totalNotes: 0, streak: 5, syllabusPercent: 0, subjectProgress: [] 
  });
  const [refreshing, setRefreshing] = useState(false);

  const [configVisible, setConfigVisible] = useState(false);
  const [widgetCategory, setWidgetCategory] = useState<'Prelims' | 'Mains' | 'Optional'>('Prelims');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [optionalChoice, setOptionalChoice] = useState('Anthropology');

  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [showManage, setShowManage] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const longPressTimer = useRef<any>(null);
  const { data: widgetData, refresh: refreshWidgets } = useWidgetData(userId);

  const activeWidgets = useMemo(() => widgets.filter(w => !w.is_archived), [widgets]);
  const archivedWidgets = useMemo(() => widgets.filter(w => w.is_archived), [widgets]);

  // Grouping logic for mixed columns
  const widgetRows = useMemo(() => {
    const rows: { id: string; items: Widget[] }[] = [];
    let currentRow: Widget[] = [];

    activeWidgets.forEach((w) => {
      if (w.size === 'full') {
        if (currentRow.length > 0) {
          rows.push({ id: currentRow.map(i => i.id).join('-'), items: currentRow });
          currentRow = [];
        }
        rows.push({ id: w.id, items: [w] });
      } else {
        currentRow.push(w);
        if (currentRow.length === 2) {
          rows.push({ id: currentRow.map(i => i.id).join('-'), items: currentRow });
          currentRow = [];
        }
      }
    });

    if (currentRow.length > 0) {
      rows.push({ id: currentRow.map(i => i.id).join('-'), items: currentRow });
    }
    return rows;
  }, [activeWidgets]);
  
  useEffect(() => {
    AsyncStorage.getItem('dashboard_widget_config').then(val => {
      if (val) {
        const parsed = JSON.parse(val);
        setWidgetCategory(parsed.category || 'Prelims');
        setSelectedSubjects(parsed.subjects || []);
      }
    });
    AsyncStorage.getItem('optional_choice').then(val => {
      if (val) setOptionalChoice(val);
    });
    if (userId) WidgetService.list(userId).then(setWidgets);
  }, [userId]);

  const saveConfig = async (category: any, subjects: string[]) => {
    const newConfig = { category, subjects };
    await AsyncStorage.setItem('dashboard_widget_config', JSON.stringify(newConfig));
    load();
  };

  const load = useCallback(async () => {
    if (!userId) return;
    const cached = await cacheGet<Stats>(`home:${userId}`);
    if (cached) setStats(cached);

    try {
      const [{ data: qs }, { count: notesCount }, { count: cardsCount }] = await Promise.all([
        supabase.from('question_states').select('is_incorrect_last_attempt').eq('user_id', userId),
        supabase.from('user_notes').select('id', { count: 'exact', head: true }).eq('user_id', userId),
        supabase.from('user_cards').select('id', { count: 'exact', head: true }).eq('user_id', userId).lte('next_review_at', new Date().toISOString()),
      ]);

      const total = qs?.length || 0;
      const correct = qs?.filter(x => x.is_incorrect_last_attempt === false)?.length || 0;
      let syllabusPercent = 0;
      let subjectProgress: { label: string; progress: number; color: string }[] = [];
      
      try {
        const progress = await SyllabusService.getProgress(userId);
        let totalItems = 0;
        let completedItems = 0;
        const subjectStats: Record<string, { total: number; completed: number; color: string }> = {};
        const COLORS = ['#007AFF', '#FF9500', '#34C759', '#AF52DE', '#FF2D55', '#5856D6', '#FFCC00'];
        let colorIdx = 0;

        let dataPool = {};
        if (widgetCategory === 'Optional') {
          const sourceSyllabus = (optionalChoice === 'Anthropology') ? require('../../src/data/syllabus').ANTHROPOLOGY_SYLLABUS : { "Paper 1": { "Fundamentals": [] }, "Paper 2": { "Indian Context": [] } };
          dataPool = { [`${optionalChoice} Paper 1`]: sourceSyllabus["Paper 1"], [`${optionalChoice} Paper 2`]: sourceSyllabus["Paper 2"] };
        } else if (widgetCategory === 'Mains') {
          dataPool = require('../../src/data/syllabus').MAINS_SYLLABUS;
        } else {
          dataPool = MICRO_SYLLABUS;
        }

        Object.entries(dataPool).forEach(([sub, groups]) => {
          if (selectedSubjects.length > 0 && !selectedSubjects.includes(sub)) return;
          if (!subjectStats[sub]) { subjectStats[sub] = { total: 0, completed: 0, color: COLORS[colorIdx % COLORS.length] }; colorIdx++; }

          Object.entries(groups as any).forEach(([group, topics]) => {
            (topics as string[]).forEach(topic => {
              totalItems++;
              const path = `${sub}.${group}.${topic}`;
              const isMastered = progress[path]?.mastered;
              if (isMastered) completedItems++;
              subjectStats[sub].total++;
              if (isMastered) subjectStats[sub].completed++;
            });
          });
        });
        
        syllabusPercent = totalItems ? Math.round((completedItems / totalItems) * 100) : 0;
        subjectProgress = Object.entries(subjectStats).map(([label, s]) => ({ label, progress: s.total ? s.completed / s.total : 0, color: s.color })).sort((a, b) => b.progress - a.progress);
      } catch (e) { console.error("Syllabus Load Error:", e); }

      const next: Stats = { attempts: total, accuracy: total ? Math.round((correct / total) * 100) : 0, dueCards: cardsCount || 0, totalNotes: notesCount || 0, streak: 5, syllabusPercent, subjectProgress };
      setStats(next);
      await cacheSet(`home:${userId}`, next);
    } catch (err) { console.error("Home Load Error:", err); }
  }, [userId, widgetCategory, selectedSubjects, optionalChoice]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); refreshWidgets(); setRefreshing(false); };

  // PATCH 6: 4-second long press is undiscoverable. Keep it as a power-user
  // shortcut but also expose a tappable "Edit" pill in the header.
  const handleLongPressIn = () => {
    longPressTimer.current = setTimeout(() => {
      Vibration.vibrate(50);
      setIsEditMode(true);
    }, 800);
  };
  const handleLongPressOut = () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); };
  const toggleEditMode = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setIsEditMode(prev => !prev);
  };

  const handleArchive = async (id: string) => {
    await WidgetService.archive(userId!, id);
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, is_archived: true } : w));
  };

  const handleReorder = async ({ data }: { data: Widget[] }) => {
    setWidgets(data);
    await WidgetService.reorder(userId!, data.map(w => w.id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const CARD_GAP = 12;
  const CARD_WIDTH = (windowWidth - spacing.lg * 2 - CARD_GAP) / 2;

  return (
    <PageWrapper>
      <DraggableFlatList
        data={widgetRows}
        keyExtractor={(item) => item.id}
        onDragEnd={({ data }) => {
          const flat = data.flatMap(row => row.items);
          handleReorder({ data: flat });
        }}
        activationDistance={10}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
        windowSize={10}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        ListEmptyComponent={() => (
          <View style={{ padding: 32, alignItems: 'center' }}>
            <Text style={{ color: colors.textTertiary, fontSize: 13 }}>
              All widgets archived. Tap "Manage Widgets" below to restore.
            </Text>
          </View>
        )}
        ListHeaderComponent={() => (
          <>
            <Pressable onPressIn={handleLongPressIn} onPressOut={handleLongPressOut} style={styles.topRow}>
              <View>
                <Text style={[styles.small, { color: colors.textTertiary }]}>{isEditMode ? 'EDITING WIDGETS' : 'DASHBOARD'}</Text>
                <Text style={[styles.h1, { color: colors.textPrimary }]}>{name}.</Text>
              </View>
              {isEditMode ? (
                <TouchableOpacity onPress={toggleEditMode} style={[styles.doneBtn, { backgroundColor: colors.primary }]}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>Done</Text>
                </TouchableOpacity>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {/* PATCH 6: discoverable Edit button */}
                  <TouchableOpacity
                    onPress={toggleEditMode}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 16,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Sliders size={14} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => router.push('/profile')} style={styles.avatarBtn}>
                    <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                      <Text style={styles.avatarText}>{(name[0] || 'A').toUpperCase()}</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              )}
            </Pressable>
            
            <View style={{ marginBottom: spacing.lg }}>
              <GlobalSearchBar 
                placeholder="Search questions, notes, topics..." 
                onSearch={(q, f) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push({ pathname: "/unified/arena", params: { tab: 'search', query: q, filters: JSON.stringify(f) } } as any);
                }}
              />
            </View>

            <View style={styles.dashboardRow}>
               <View style={[styles.streakCard, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '20' }]}>
                  <Flame color={colors.primary} size={24} fill={colors.primary} />
                  <View style={{ marginLeft: 12 }}>
                     <Text style={[styles.streakVal, { color: colors.textPrimary }]}>{stats.streak} Days</Text>
                     <Text style={[styles.streakLab, { color: colors.textSecondary }]}>Daily Streak</Text>
                  </View>
               </View>
               <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Target color={colors.primary} size={24} />
                  <View style={{ marginLeft: 12 }}>
                     <Text style={[styles.streakVal, { color: colors.textPrimary }]}>{stats.accuracy}%</Text>
                     <Text style={[styles.streakLab, { color: colors.textSecondary }]}>Accuracy</Text>
                  </View>
               </View>
            </View>



            <TouchableOpacity style={[styles.progressCard, { backgroundColor: colors.surface, borderColor: colors.border }]} activeOpacity={0.9} onPress={() => router.push('/tracker')} onLongPress={() => setConfigVisible(true)}>
              <View style={styles.progressHeader}>
                <View style={[styles.iconBox, { backgroundColor: colors.primary + '15' }]}><Layout color={colors.primary} size={22} /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Syllabus Tracker</Text>
                    <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.primary + '10' }}>
                       <Text style={{ fontSize: 9, fontWeight: '900', color: colors.primary }}>{widgetCategory.toUpperCase()}</Text>
                    </View>
                  </View>
                  <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>Long press to edit subjects</Text>
                </View>
                <View style={[styles.percentBox, { backgroundColor: colors.primary + '15' }]}>
                  <Text style={[styles.percentText, { color: colors.primary }]}>{stats.syllabusPercent}%</Text>
                </View>
              </View>
              <View style={{ maxHeight: 180 }}>
                <ScrollView showsVerticalScrollIndicator={true} nestedScrollEnabled={true}>
                  <View style={styles.progressList}>
                     {stats.subjectProgress.length > 0 ? (
                       stats.subjectProgress.map((sp) => (<SubjectProgress key={sp.label} label={sp.label} progress={sp.progress} color={sp.color} colors={colors} />))
                     ) : (
                       <View style={{ alignItems: 'center', justifyContent: 'center', height: 120 }}>
                          <Layout color={colors.textTertiary} size={32} opacity={0.3} />
                          <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 12, textAlign: 'center' }}>No subjects selected for {widgetCategory}</Text>
                       </View>
                     )}
                  </View>
                </ScrollView>
              </View>
            </TouchableOpacity>

            <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: 24 }]}>RESUME ACTIONS</Text>
            <View style={styles.resumeGrid}>
               <ResumeCard icon={<Layout color="#007AFF" size={20} />} label="Syllabus" sub="Track progress" onPress={() => router.push('/tracker')} colors={colors} width={CARD_WIDTH} />
               <ResumeCard icon={<RotateCcw color="#FF2D55" size={20} />} label="Flashcards" sub="Daily review" onPress={() => router.push('/flashcards')} colors={colors} width={CARD_WIDTH} />
               <ResumeCard icon={<History color="#8E8E93" size={20} />} label="Review" sub="Past attempts" onPress={() => router.push({ pathname: '/analyse', params: { mode: 'review' } })} colors={colors} width={CARD_WIDTH} />
               <ResumeCard icon={<BarChart3 color="#34C759" size={20} />} label="Analyse" sub="Performance" onPress={() => router.push({ pathname: '/analyse', params: { mode: 'overall' } })} colors={colors} width={CARD_WIDTH} />
            </View>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: 24 }]}>MY WIDGETS</Text>
          </>
        )}
        renderItem={({ item: row, drag, isActive }) => (
          <ScaleDecorator>
            <View style={{ flexDirection: 'row', gap: CARD_GAP, marginBottom: CARD_GAP }}>
              {row.items.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  onLongPress={isEditMode ? drag : undefined}
                  delayLongPress={200}
                  disabled={isActive}
                  activeOpacity={0.9}
                  style={{
                    flex: item.size === 'full' ? 1 : 0.5,
                    opacity: isActive ? 0.85 : 1,
                  }}
                >
                  <View style={{ position: 'relative' }}>
                    <WidgetRenderer
                      widgetKey={item.widget_key}
                      data={widgetData}
                      onArchive={isEditMode ? () => handleArchive(item.id) : undefined}
                    />
                    {isEditMode && (
                      <View style={styles.editOverlay}>
                        <TouchableOpacity 
                          onPress={async () => {
                            const nextSize = item.size === 'full' ? 'half' : 'full';
                            await WidgetService.setSize(userId!, item.id, nextSize);
                            setWidgets(prev => prev.map(w => w.id === item.id ? { ...w, size: nextSize } : w));
                          }}
                          style={styles.sizeToggle}
                        >
                          <Maximize2 size={12} color="#fff" />
                          <Text style={styles.sizeToggleText}>{item.size.toUpperCase()}</Text>
                        </TouchableOpacity>
                        <GripVertical size={12} color="#fff" />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
              {row.items.length === 1 && row.items[0].size === 'half' && <View style={{ flex: 0.5 }} />}
            </View>
          </ScaleDecorator>
        )}
        ListFooterComponent={() => (
          <>
            <TouchableOpacity onPress={() => setShowManage(true)} style={{ padding: 12, alignItems: 'center', marginBottom: 4 }}>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Manage Widgets ({archivedWidgets.length} archived)</Text>
            </TouchableOpacity>

            <View style={[styles.analyticsPromo, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 24 }]}>
               <View style={{ flex: 1 }}>
                  <Text style={[styles.promoTitle, { color: colors.textPrimary }]}>Detailed Analysis</Text>
                  <Text style={[styles.promoSub, { color: colors.textSecondary }]}>Check your weak areas and subject trends in the Analyse tab.</Text>
               </View>
               <TouchableOpacity style={[styles.promoBtn, { backgroundColor: colors.primary }]} onPress={() => router.push('/(tabs)/analyse')}>
                  <BarChart3 color="#FFF" size={20} />
               </TouchableOpacity>
            </View>

            <Modal visible={showManage} transparent animationType="slide" onRequestClose={() => setShowManage(false)}>
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
                <View style={{ backgroundColor: colors.surface, padding: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={{ fontSize: 20, fontWeight: '900', color: colors.textPrimary }}>Manage Widgets</Text>
                    <TouchableOpacity onPress={() => setShowManage(false)}><X color={colors.textPrimary} size={24} /></TouchableOpacity>
                  </View>
                  
                  <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textTertiary, marginBottom: 12 }}>ARCHIVED WIDGETS</Text>
                  <ScrollView nestedScrollEnabled style={{ maxHeight: 200 }}>
                    {archivedWidgets.length === 0 ? (
                      <Text style={{ color: colors.textTertiary, textAlign: 'center', padding: 24 }}>No archived widgets.</Text>
                    ) : (
                      archivedWidgets.map(w => (
                        <View
                          key={w.id}
                          style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 }}
                        >
                          <Text style={{ color: colors.textPrimary, flex: 1 }}>
                            {w.widget_key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </Text>
                          <TouchableOpacity
                            onPress={async () => {
                              await WidgetService.restore(userId!, w.id);
                              setWidgets(prev => prev.map(x => x.id === w.id ? { ...x, is_archived: false } : x));
                              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                            }}
                            style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary + '15' }}
                          >
                            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>RESTORE</Text>
                          </TouchableOpacity>
                        </View>
                      ))
                    )}
                  </ScrollView>

                  <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textTertiary, marginTop: 20, marginBottom: 12 }}>AVAILABLE WIDGETS TO ADD</Text>
                  <ScrollView nestedScrollEnabled>
                    {['daily_goal', 'exam_countdown', 'questions_today', 'study_time_today', 'weekly_streak', 'accuracy_trend', 'correct_incorrect', 'speed_meter', 'due_cards', 'mastery_ring', 'pyq_coverage', 'recent_notes', 'tagged_count', 'quick_practice', 'last_test', 'test_scores', 'study_heatmap'].map(key => {
                      const isActive = activeWidgets.some(w => w.widget_key === key);
                      return (
                        <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                          <Text style={{ color: colors.textPrimary, textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</Text>
                          {isActive ? (
                            <Text style={{ color: colors.textTertiary }}>Active</Text>
                          ) : (
                            <TouchableOpacity onPress={async () => {
                              await WidgetService.create(userId!, key);
                              WidgetService.list(userId!).then(setWidgets);
                            }}>
                              <Text style={{ color: colors.primary, fontWeight: '800' }}>ADD</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>

                  <TouchableOpacity onPress={() => setShowManage(false)} style={{ padding: 16, alignItems: 'center', marginTop: 16 }}>
                    <Text style={{ color: colors.textTertiary, fontWeight: '700' }}>CLOSE</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          </>
        )}
      />
      <WidgetConfigModal visible={configVisible} onClose={() => setConfigVisible(false)} onSave={saveConfig} category={widgetCategory} setCategory={setWidgetCategory} selectedSubjects={selectedSubjects} setSelectedSubjects={setSelectedSubjects} optionalChoice={optionalChoice} colors={colors} />
    </PageWrapper>
  );
}

function SubjectProgress({ label, progress, color, colors }: any) {
  return (
    <View style={styles.subProg}>
      <View style={styles.subProgLabels}>
        <Text style={[styles.subLabel, { color: colors.textPrimary }]}>{label}</Text>
        <Text style={[styles.subValue, { color: colors.textSecondary }]}>{Math.round(progress * 100)}%</Text>
      </View>
      <View style={[styles.barBg, { backgroundColor: colors.border }]}>
        <View style={[styles.barFill, { backgroundColor: color, width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

function WidgetConfigModal({ visible, onClose, onSave, category, setCategory, selectedSubjects, setSelectedSubjects, optionalChoice, colors }: any) {
  const categories = ['Prelims', 'Mains', 'Optional'];
  const subjects = useMemo(() => {
    if (category === 'Optional') return [`${optionalChoice} Paper 1`, `${optionalChoice} Paper 2`];
    if (category === 'Mains') return Object.keys(require('../../src/data/syllabus').MAINS_SYLLABUS);
    return Object.keys(MICRO_SYLLABUS);
  }, [category, optionalChoice]);

  const toggleSubject = (s: string) => {
    if (selectedSubjects.includes(s)) setSelectedSubjects(selectedSubjects.filter((x: string) => x !== s));
    else setSelectedSubjects([...selectedSubjects, s]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={[styles.modalContent, { backgroundColor: colors.surface }]} onStartShouldSetResponder={() => true}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Widget Settings</Text>
            <TouchableOpacity onPress={onClose}><X color={colors.textPrimary} size={24} /></TouchableOpacity>
          </View>
          <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>SYLLABUS CATEGORY</Text>
          <View style={styles.catRow}>
            {categories.map(c => (
              <TouchableOpacity key={c} style={[styles.catBtn, { backgroundColor: category === c ? colors.primary : colors.surfaceStrong }]} onPress={() => setCategory(c)}>
                <Text style={[styles.catText, { color: category === c ? '#fff' : colors.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.modalLabel, { color: colors.textSecondary, marginTop: 24 }]}>VISIBLE SUBJECTS</Text>
          <ScrollView contentContainerStyle={styles.subGrid}>
            <TouchableOpacity style={[styles.subItem, selectedSubjects.length === 0 && { backgroundColor: colors.primary + '20', borderColor: colors.primary }]} onPress={() => setSelectedSubjects([])}>
              <Text style={[styles.subText, { color: colors.textPrimary }, selectedSubjects.length === 0 && { color: colors.primary, fontWeight: '800' }]}>All Subjects</Text>
            </TouchableOpacity>
            {subjects.map((s: any) => (
              <TouchableOpacity key={s} style={[styles.subItem, selectedSubjects.includes(s) && { backgroundColor: colors.primary + '20', borderColor: colors.primary }]} onPress={() => toggleSubject(s)}>
                <Text style={[styles.subText, { color: colors.textPrimary }, selectedSubjects.includes(s) && { color: colors.primary, fontWeight: '800' }]}>{s}</Text>
                {selectedSubjects.includes(s) && <Check size={14} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={[styles.applyBtn, { backgroundColor: colors.primary }]} onPress={() => { onSave(category, selectedSubjects); onClose(); }}>
            <Text style={styles.applyText}>Done</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}

function ResumeCard({ icon, label, sub, onPress, colors, width }: any) {
  return (
    <TouchableOpacity style={[styles.resumeCard, { backgroundColor: colors.surface, borderColor: colors.border, width }]} onPress={onPress}>
      <View style={styles.resumeIcon}>{icon}</View>
      <Text style={[styles.resumeLabel, { color: colors.textPrimary }]}>{label}</Text>
      <Text style={[styles.resumeSub, { color: colors.textSecondary }]}>{sub}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  small: { fontSize: 11, letterSpacing: 2, fontWeight: '800' },
  h1: { fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  avatarBtn: { elevation: 2 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF' },
  avatarText: { color: '#fff', fontWeight: '900', fontSize: 20 },
  dashboardRow: { flexDirection: 'row', gap: 12 },
  streakCard: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, borderWidth: 1 },
  summaryCard: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, borderWidth: 1 },
  streakVal: { fontSize: 18, fontWeight: '900' },
  streakLab: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  sectionTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' },
  resumeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  resumeCard: { padding: 16, borderRadius: 20, borderWidth: 1 },
  resumeIcon: { marginBottom: 12 },
  resumeLabel: { fontSize: 15, fontWeight: '800' },
  resumeSub: { fontSize: 12, marginTop: 2 },
  analyticsPromo: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 24, borderWidth: 1, marginTop: 20 },
  promoTitle: { fontSize: 18, fontWeight: '800' },
  promoSub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  promoBtn: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginLeft: 16 },

  progressCard: { padding: 20, borderRadius: 24, borderWidth: 1, marginTop: 20 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  iconBox: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 18, fontWeight: '800' },
  cardDesc: { fontSize: 13, marginTop: 2 },
  percentBox: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  percentText: { fontWeight: '900', fontSize: 16 },
  progressList: { gap: 12 },
  subProg: { gap: 6 },
  subProgLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  subLabel: { fontSize: 13, fontWeight: '700' },
  subValue: { fontSize: 12, fontWeight: '600' },
  barBg: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 22, fontWeight: '900' },
  modalLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 12 },
  catRow: { flexDirection: 'row', gap: 10 },
  catBtn: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  catText: { fontSize: 14, fontWeight: '700' },
  subGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 20 },
  subItem: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)', flexDirection: 'row', alignItems: 'center', gap: 8 },
  subText: { fontSize: 13, fontWeight: '600' },
  applyBtn: { height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  applyText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  doneBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  editOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sizeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  sizeToggleText: { color: '#fff', fontSize: 9, fontWeight: '900' },
});
