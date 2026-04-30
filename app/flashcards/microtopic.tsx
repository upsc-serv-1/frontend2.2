import React, { useState, useEffect, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  FlatList, 
  SafeAreaView, 
  ActivityIndicator,
  Dimensions,
  Platform,
  TextInput,
  Modal,
  ScrollView,
  Alert,
  RefreshControl
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { 
  ArrowLeft, 
  Play, 
  Plus, 
  BookOpen,
  SortAsc,
  SortDesc,
  X,
  Trash2,
  Check
} from 'lucide-react-native';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { PageWrapper } from '../../src/components/PageWrapper';
import { FlashcardSvc } from '../../src/services/FlashcardService';
import { supabase } from '../../src/lib/supabase';
import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');

interface CardItem {
  id: string;
  front_text: string;
  back_text: string;
  status: 'active' | 'frozen';
  learning_status: 'not_studied' | 'learning' | 'review' | 'mastered' | 'leech';
  next_review?: string;
  updated_at: string;
  preview?: string;
  user_note?: string;
}

export default function MicrotopicModal() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const { subject, section, microtopic } = useLocalSearchParams();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [stats, setStats] = useState({ due: 0, new: 0, learning: 0, mastered: 0 });
  const [sortBy, setSortBy] = useState<'next' | 'newest' | 'oldest' | 'az'>('next');
  const [filterBy, setFilterBy] = useState<string>('all');
  
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);

  useEffect(() => {
    if (session?.user.id) loadCards();
  }, [session, microtopic]);

  const loadCards = async () => {
    if (!refreshing) setLoading(true);
    try {
      const userId = session!.user.id;
      const allParams = { subject, microtopic, section };
      console.log('[FlashcardDeck] Raw Params:', JSON.stringify(allParams));

      const sSubject = (Array.isArray(subject) ? subject[0] : (subject as string)) || '';
      const sTopic = (Array.isArray(microtopic) ? microtopic[0] : (microtopic as string)) || '';
      const sSection = (Array.isArray(section) ? section[0] : (section as string)) || 'General';

      console.log(`[FlashcardDeck] Cleaned Params: sub="${sSubject}", topic="${sTopic}", sec="${sSection}"`);

      // 1. Build Base Query
      const baseQuery = supabase
        .from('cards')
        .select('*')
        .ilike('subject', sSubject)
        .ilike('microtopic', sTopic);

      const [baseRes, progRes] = await Promise.all([
        baseQuery,
        supabase
          .from('user_cards')
          .select('*')
          .eq('user_id', userId),
      ]);

      if (baseRes.error) console.error('[FlashcardDeck] Base Query Error:', baseRes.error);
      if (progRes.error) console.error('[FlashcardDeck] Prog Query Error:', progRes.error);

      const base = baseRes.data || [];
      const prog = progRes.data || [];
      
      console.log(`[FlashcardDeck] DB Results: base=${base.length}, user_cards=${prog.length}`);
      
      if (base.length === 0) {
        // Fallback check: list ANY microtopics for this subject to see casing/naming
        const { data: topics } = await supabase.from('cards').select('microtopic').ilike('subject', sSubject).limit(10);
        console.log(`[FlashcardDeck] Diagnostic: Top 10 topics for "${sSubject}":`, topics?.map(t => t.microtopic));
      }

      const progByCardId: Record<string, any> = {};
      prog.forEach((p: any) => (progByCardId[p.card_id] = p));

      const merged: CardItem[] = base.map((bc: any) => {
        const p = progByCardId[bc.id] || {};
        return {
          id: bc.id,
          front_text: bc.front_text || bc.question_text || '',
          back_text:  bc.back_text  || bc.answer_text  || '',
          status:     p.status     || 'active',
          learning_status: p.learning_status || 'not_studied',
          next_review: p.next_review,
          updated_at:  p.updated_at || bc.created_at,
          preview:     (p.user_note || bc.front_text || bc.question_text || '').slice(0, 80),
          user_note:   p.user_note || '',
        };
      });
      setCards(merged);

      // Recompute tally directly from merged (avoids view-lag on just-linked cards)
      const now = Date.now();
      const activeCards = merged.filter(c => c.status !== 'deleted');
      
      console.log(`[FlashcardDeck] Stats check: Total=${merged.length}, Active=${activeCards.length}`);
      const studied = activeCards.filter(c => c.learning_status !== 'not_studied');
      if (studied.length > 0) {
        console.log(`[FlashcardDeck] Studied cards detected:`, studied.map(c => ({ id: c.id, status: c.status, learning: c.learning_status, next: c.next_review })));
      }

      setStats({
        due:      activeCards.filter(c => {
          const isDue = !c.next_review || new Date(c.next_review).getTime() <= now;
          return isDue && c.status !== 'frozen';
        }).length,
        new:      activeCards.filter(c => !c.learning_status || c.learning_status === 'not_studied').length,
        learning: activeCards.filter(c => c.learning_status === 'learning' || c.learning_status === 'review').length,
        mastered: activeCards.filter(c => c.learning_status === 'mastered').length,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCards();
    setRefreshing(false);
  };

  const filteredAndSortedCards = useMemo(() => {
    let result = cards.filter(c => c.status !== 'deleted');
    
    // Filter
    if (filterBy === 'all') {
      // Show everything not deleted
    } else if (filterBy === 'due') {
      const now = Date.now();
      result = result.filter(c => (!c.next_review || new Date(c.next_review).getTime() <= now) && c.status !== 'frozen');
    } else if (filterBy === 'new') {
      result = result.filter(c => !c.learning_status || c.learning_status === 'not_studied');
    } else if (filterBy === 'learning') {
      result = result.filter(c => c.learning_status === 'learning' || c.learning_status === 'review');
    } else if (filterBy === 'mastered') {
      result = result.filter(c => c.learning_status === 'mastered');
    } else if (filterBy === 'frozen') {
      result = result.filter(c => c.status === 'frozen');
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'next') {
        const ad = a.next_review ? new Date(a.next_review).getTime() : 0;
        const bd = b.next_review ? new Date(b.next_review).getTime() : 0;
        return ad - bd;
      }
      if (sortBy === 'newest') return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      return 0;
    });

    return result;
  }, [cards, sortBy, filterBy]);

  const handleDeleteCard = async (cardId: string) => {
    if (!session?.user.id) return;
    
    const confirmDelete = () => {
      Alert.alert(
        "Delete Card",
        "Are you sure you want to remove this card from your deck? Your progress will be lost.",
        [
          { text: "Cancel", style: "cancel" },
          { 
            text: "Delete", 
            style: "destructive", 
            onPress: async () => {
              try {
                await FlashcardSvc.deleteCard(session.user.id, cardId);
                setCards(prev => prev.filter(c => c.id !== cardId));
                
                // Refresh stats to reflect deletion
                const sec = (section as string) || 'General';
                const summary = await FlashcardSvc.getDeckSummary(session.user.id, subject as string, sec, microtopic as string);
                setStats({
                  due: summary.due_count ?? 0,
                  new: summary.new_count ?? 0,
                  learning: summary.learning_count ?? 0,
                  mastered: summary.mastered_count ?? 0,
                });

                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              } catch (err) {
                console.error("Delete error:", err);
                Alert.alert("Error", "Failed to delete card.");
              }
            }
          }
        ]
      );
    };

    confirmDelete();
  };

  const renderCardItem = ({ item }: { item: CardItem }) => {
    const showText = item.user_note?.trim()
      ? item.user_note
      : (item.preview || item.front_text || '').replace(/\n+/g, ' ');
    const dueDate = item.next_review ? new Date(item.next_review) : null;
    const daysUntil = dueDate ? Math.ceil((dueDate.getTime() - Date.now()) / 86400000) : null;
    const dueLabel = daysUntil === null ? 'New'
      : daysUntil <= 0 ? 'Due today'
      : daysUntil === 1 ? 'Tomorrow'
      : `in ${daysUntil}d`;

    return (
      <View style={[styles.cardItemContainer, { borderColor: colors.border }]}>
        <TouchableOpacity
          style={styles.cardItemMain}
          onPress={() => router.push({
            pathname: '/flashcards/review',
            params: { microtopic, subject, section, cardId: item.id },
          })}
        >
          <View style={styles.cardTop}>
            <View style={[styles.statusDot, {
              backgroundColor:
                item.status === 'frozen' ? '#94a3b8' :
                item.learning_status === 'mastered' ? '#34c759' :
                item.learning_status === 'learning' ? '#3b82f6' :
                item.learning_status === 'leech' ? '#ef4444' : '#cbd5e1',
            }]} />
            <Text style={[styles.cardPreview, { color: colors.textPrimary }]} numberOfLines={2}>
              {showText || 'Untitled card'}
            </Text>
          </View>
          <View style={styles.cardBottom}>
            <Text style={[styles.cardMeta, { color: colors.textTertiary }]}>
              {item.learning_status.replace('_', ' ').toUpperCase()} • {dueLabel}
            </Text>
          </View>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.deleteCardBtn}
          onPress={() => handleDeleteCard(item.id)}
        >
          <Trash2 size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <PageWrapper>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        {/* HEADER */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>{microtopic}</Text>
            <Text style={[styles.headerSub, { color: colors.textTertiary }]}>{subject} • {section}</Text>
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={() => setIsAddModalVisible(true)}>
            <Plus size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <FlatList
          ListHeaderComponent={
            <View>
              {/* STATS & PROGRESS */}
              <View style={styles.statsPanel}>
                <View style={styles.statsRow}>
                  <StatItem label="Due" value={stats.due} color={colors.primary} />
                  <StatItem label="New" value={stats.new} color={colors.textTertiary} />
                  <StatItem label="Learning" value={stats.learning} color="#3b82f6" />
                  <StatItem label="Mastered" value={stats.mastered} color="#34c759" />
                </View>
                
                <View style={styles.progressContainer}>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${(stats.mastered / (cards.length || 1)) * 100}%`, backgroundColor: '#34c759' }]} />
                    <View style={[styles.progressFill, { width: `${(stats.learning / (cards.length || 1)) * 100}%`, backgroundColor: '#3b82f6' }]} />
                  </View>
                  <Text style={[styles.progressText, { color: colors.textTertiary }]}>
                    {stats.mastered} of {cards.length} cards mastered
                  </Text>
                </View>

                {stats.due === 0 && (
                  <View style={{ alignItems: 'center', marginBottom: 24, padding: 20, backgroundColor: colors.primary + '10', borderRadius: 24, borderWidth: 1, borderColor: colors.primary + '20' }}>
                    <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                      <Check size={28} color="#fff" strokeWidth={3} />
                    </View>
                    <Text style={{ fontSize: 20, fontWeight: '900', color: colors.textPrimary, marginBottom: 8 }}>All done for now!</Text>
                    <Text style={{ fontSize: 13, color: colors.textTertiary, textAlign: 'center', lineHeight: 18 }}>
                      You've reviewed all scheduled cards. Check back later or add new ones to continue!
                    </Text>
                  </View>
                )}

                <TouchableOpacity 
                  style={[
                    styles.studyBtn, 
                    { backgroundColor: colors.primary },
                    stats.due === 0 && { backgroundColor: colors.surfaceStrong, opacity: 0.6 }
                  ]}
                  disabled={stats.due === 0}
                  onPress={() => router.push({ pathname: '/flashcards/review', params: { microtopic, subject, section, mode: 'due' } })}
                >
                  <Play size={20} color={stats.due === 0 ? colors.textTertiary : "#fff"} fill={stats.due === 0 ? colors.textTertiary : "#fff"} />
                  <Text style={[styles.studyBtnText, stats.due === 0 && { color: colors.textTertiary }]}>Study Cards</Text>
                </TouchableOpacity>
              </View>

              {/* FILTERS & LIST */}
              <View style={styles.listSection}>
                <View style={styles.listHeader}>
                  <View style={styles.filterRow}>
                    <TouchableOpacity style={[styles.filterChip, filterBy === 'all' && { backgroundColor: colors.primary }]} onPress={() => setFilterBy('all')}>
                      <Text style={[styles.filterText, filterBy === 'all' && { color: '#fff' }]}>All Active</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.filterChip, filterBy === 'due' && { backgroundColor: '#f59e0b' }]} onPress={() => setFilterBy('due')}>
                      <Text style={[styles.filterText, filterBy === 'due' && { color: '#fff' }]}>Due</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.filterChip, filterBy === 'new' && { backgroundColor: '#94a3b8' }]} onPress={() => setFilterBy('new')}>
                      <Text style={[styles.filterText, filterBy === 'new' && { color: '#fff' }]}>New</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.filterChip, filterBy === 'learning' && { backgroundColor: '#3b82f6' }]} onPress={() => setFilterBy('learning')}>
                      <Text style={[styles.filterText, filterBy === 'learning' && { color: '#fff' }]}>Learning</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.filterChip, filterBy === 'mastered' && { backgroundColor: '#34c759' }]} onPress={() => setFilterBy('mastered')}>
                      <Text style={[styles.filterText, filterBy === 'mastered' && { color: '#fff' }]}>Mastered</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.filterChip, filterBy === 'frozen' && { backgroundColor: '#ef4444' }]} onPress={() => setFilterBy('frozen')}>
                      <Text style={[styles.filterText, filterBy === 'frozen' && { color: '#fff' }]}>Frozen</Text>
                    </TouchableOpacity>
                  </View>
                  
                  <TouchableOpacity style={styles.sortBtn} onPress={() => setSortBy(sortBy === 'next' ? 'newest' : 'next')}>
                    {sortBy === 'next' ? <SortAsc size={18} color={colors.textTertiary} /> : <SortDesc size={18} color={colors.textTertiary} />}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          }
          data={filteredAndSortedCards}
          keyExtractor={item => item.id}
          renderItem={renderCardItem}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <View style={styles.empty}>
                <BookOpen size={48} color={colors.border} />
                <Text style={{ color: colors.textTertiary, marginTop: 12 }}>No cards match your filter</Text>
              </View>
            )
          }
        />

        {/* ADD CARDS MODAL */}
        <Modal visible={isAddModalVisible} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: colors.surface, height: '90%' }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Add to {microtopic}</Text>
                <TouchableOpacity onPress={() => setIsAddModalVisible(false)}><X size={24} color={colors.textPrimary} /></TouchableOpacity>
              </View>
              
              <Text style={{ color: colors.textTertiary, marginBottom: 20 }}>Select questions to convert into flashcards.</Text>
              
              <FlatList
                data={cards.filter(c => c.learning_status === 'not_studied')} // Placeholder for provider filtering
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity style={[styles.selectableItem, { borderColor: colors.border }]}>
                    <Text style={[styles.selectableText, { color: colors.textPrimary }]} numberOfLines={2}>{item.front_text}</Text>
                    <View style={[styles.checkbox, { borderColor: colors.primary }]} />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={{ textAlign: 'center', marginTop: 40, color: colors.textTertiary }}>No new questions available in this topic.</Text>}
              />
              
              <TouchableOpacity style={[styles.studyBtn, { backgroundColor: colors.primary, marginTop: 20 }]} onPress={() => setIsAddModalVisible(false)}>
                <Text style={styles.studyBtnText}>Add Selected Cards</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </PageWrapper>
  );
}

function StatItem({ label, value, color }: any) {
  const { colors } = useTheme();
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statVal, { color }]}>{value}</Text>
      <Text style={[styles.statLab, { color: colors.textTertiary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerInfo: { flex: 1, marginLeft: 10 },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  headerSub: { fontSize: 12, marginTop: 2 },
  addBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  statsPanel: { padding: 20 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  statItem: { alignItems: 'center', flex: 1 },
  statVal: { fontSize: 20, fontWeight: '900' },
  statLab: { fontSize: 10, fontWeight: '800', marginTop: 4, textTransform: 'uppercase' },
  progressContainer: { marginBottom: 24 },
  progressBar: { height: 8, backgroundColor: '#f1f5f9', borderRadius: 4, flexDirection: 'row', overflow: 'hidden' },
  progressFill: { height: '100%' },
  progressText: { fontSize: 12, marginTop: 8, fontWeight: '600', textAlign: 'center' },
  studyBtn: { height: 56, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, elevation: 4 },
  studyBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  listSection: { flex: 1, paddingHorizontal: 20 },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: '#f1f5f9' },
  filterText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  sortBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' },
  cardItemContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    borderRadius: 16, 
    borderWidth: 1, 
    marginBottom: 10,
    overflow: 'hidden'
  },
  cardItemMain: { 
    flex: 1,
    padding: 16,
  },
  deleteCardBtn: {
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  cardPreview: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  cardBottom: { marginTop: 10, paddingLeft: 20 },
  cardMeta: { fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', marginTop: 60 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  selectableItem: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 10, gap: 12 },
  selectableText: { flex: 1, fontSize: 14, fontWeight: '600' },
  checkbox: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 }
});
