import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  ActivityIndicator,
  TextInput,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Play,
  Plus,
  SortAsc,
  SortDesc,
  MoreHorizontal,
  BookOpen,
  X,
  Check,
  Minus,
} from 'lucide-react-native';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { PageWrapper } from '../../src/components/PageWrapper';
import { FlashcardSvc } from '../../src/services/FlashcardService';
import { CardOverflowMenu, CardMenuAction } from '../../src/components/flashcards/CardOverflowMenu';

interface CardItem {
  id: string;
  front_text: string;
  back_text: string;
  status: 'active' | 'frozen' | 'deleted';
  learning_status: 'not_studied' | 'learning' | 'mastered';
  next_review?: string;
  updated_at: string;
}

type MoveTarget = {
  subject: string;
  section_group: string;
  microtopic: string;
};

type MoveNodeType = 'subject' | 'section' | 'microtopic';

type MoveTreeNode = {
  id: string;
  type: MoveNodeType;
  name: string;
  level: number;
  parentId: string | null;
  isOpen: boolean;
  subject: string;
  section_group: string;
  microtopic: string;
};

function normalizeLabel(value: unknown, fallback = 'General') {
  if (value === null || value === undefined) return fallback;
  const text = String(Array.isArray(value) ? value[0] : value).trim();
  return text.length ? text : fallback;
}

function buildNodeId(subject: string, section: string, microtopic?: string) {
  return microtopic ? `${subject}|${section}|${microtopic}` : `${subject}|${section}`;
}

export default function MicrotopicModal() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams();

  const currentSubject = normalizeLabel(params.subject);
  const currentSection = normalizeLabel(params.section);
  const currentMicrotopic = normalizeLabel(params.microtopic);

  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [stats, setStats] = useState({ due: 0, new: 0, learning: 0, mastered: 0 });
  const [sortBy, setSortBy] = useState<'next' | 'newest' | 'oldest' | 'az'>('next');
  const [filterBy, setFilterBy] = useState<string>('all');

  const [isAddModalVisible, setIsAddModalVisible] = useState(false);

  const [menuCard, setMenuCard] = useState<CardItem | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuBusy, setMenuBusy] = useState(false);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [editVisible, setEditVisible] = useState(false);
  const [editFront, setEditFront] = useState('');
  const [editBack, setEditBack] = useState('');

  const [moveVisible, setMoveVisible] = useState(false);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveTree, setMoveTree] = useState<MoveTreeNode[]>([]);
  const [selectedMoveTarget, setSelectedMoveTarget] = useState<MoveTarget | null>(null);

  const moveHierarchyRef = useRef<{
    sectionsMap: Record<string, string[]>;
    microtopicsMap: Record<string, string[]>;
  }>({ sectionsMap: {}, microtopicsMap: {} });

  useEffect(() => {
    if (session?.user.id) loadCards();
  }, [session?.user?.id, currentSubject, currentSection, currentMicrotopic]);

  const loadCards = async () => {
    setLoading(true);
    try {
      // 1) cards in current microtopic
      let query = supabase.from('cards').select('*').eq('subject', currentSubject).eq('microtopic', currentMicrotopic);

      if (currentSection === 'General') {
        query = query.or('section_group.is.null,section_group.eq.General');
      } else {
        query = query.eq('section_group', currentSection);
      }

      const { data: baseCards, error: bErr } = await query;
      if (bErr) throw bErr;

      // 2) user states for these cards
      const cardIds = (baseCards || []).map((c: any) => c.id);
      const { data: progress, error: pErr } = await supabase
        .from('user_cards')
        .select('*')
        .eq('user_id', session?.user.id)
        .in('card_id', cardIds);

      if (pErr) throw pErr;

      const progressMap = new Map<string, any>();
      progress?.forEach((p: any) => progressMap.set(p.card_id, p));

      const merged: CardItem[] = (baseCards || []).map((bc: any) => {
        const p = progressMap.get(bc.id);
        return {
          id: bc.id,
          front_text: bc.front_text || bc.question_text || '',
          back_text: bc.back_text || bc.answer_text || '',
          status: p?.status || 'active',
          learning_status: p?.learning_status || 'not_studied',
          next_review: p?.next_review,
          updated_at: p?.updated_at || bc.created_at,
        };
      });

      const visible = merged.filter((c) => c.status !== 'deleted');
      setCards(visible);

      const now = new Date();
      setStats({
        due: visible.filter((c) => c.status === 'active' && (!c.next_review || new Date(c.next_review) <= now)).length,
        new: visible.filter((c) => c.learning_status === 'not_studied').length,
        learning: visible.filter((c) => c.learning_status === 'learning').length,
        mastered: visible.filter((c) => c.learning_status === 'mastered').length,
      });
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Could not load cards');
    } finally {
      setLoading(false);
    }
  };

  const filteredAndSortedCards = useMemo(() => {
    let result = [...cards];

    if (filterBy !== 'all') {
      if (filterBy === 'frozen') result = result.filter((c) => c.status === 'frozen');
      else if (filterBy === 'not_studied') result = result.filter((c) => c.learning_status === 'not_studied' && c.status === 'active');
      else result = result.filter((c) => c.learning_status === filterBy && c.status === 'active');
    } else {
      result = result.filter((c) => c.status === 'active');
    }

    result.sort((a, b) => {
      if (sortBy === 'next') {
        const ad = a.next_review ? new Date(a.next_review).getTime() : 0;
        const bd = b.next_review ? new Date(b.next_review).getTime() : 0;
        return ad - bd;
      }
      if (sortBy === 'newest') return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      if (sortBy === 'oldest') return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      return a.front_text.localeCompare(b.front_text);
    });

    return result;
  }, [cards, sortBy, filterBy]);

  const toggleSelected = (cardId: string) => {
    setSelectionMode(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  const openMenu = (card: CardItem) => {
    setMenuCard(card);
    setMenuVisible(true);
  };

  const closeMenu = () => {
    setMenuVisible(false);
  };

  const openEdit = () => {
    if (!menuCard) return;
    setEditFront(menuCard.front_text || '');
    setEditBack(menuCard.back_text || '');
    setEditVisible(true);
  };

  const buildSectionNodes = (subject: string): MoveTreeNode[] => {
    const sections = moveHierarchyRef.current.sectionsMap[subject] || ['General'];
    return sections
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((sectionName) => ({
        id: buildNodeId(subject, sectionName),
        type: 'section' as const,
        name: sectionName,
        level: 1,
        parentId: subject,
        isOpen: false,
        subject,
        section_group: sectionName,
        microtopic: 'General',
      }));
  };

  const buildMicroNodes = (subject: string, section: string): MoveTreeNode[] => {
    const key = buildNodeId(subject, section);
    const micros = moveHierarchyRef.current.microtopicsMap[key] || ['General'];
    return micros
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((micro) => ({
        id: buildNodeId(subject, section, micro),
        type: 'microtopic' as const,
        name: micro,
        level: 2,
        parentId: buildNodeId(subject, section),
        isOpen: false,
        subject,
        section_group: section,
        microtopic: micro,
      }));
  };

  const loadMoveTree = async () => {
    if (!session?.user?.id) return;

    const { data, error } = await supabase
      .from('user_cards')
      .select('cards!inner(subject, section_group, microtopic)')
      .eq('user_id', session.user.id)
      .neq('status', 'deleted');

    if (error) throw error;

    const subjects = new Set<string>();
    const sectionsMap: Record<string, Set<string>> = {};
    const microtopicsMap: Record<string, Set<string>> = {};

    (data || []).forEach((row: any) => {
      const card = row.cards;
      const subjectName = normalizeLabel(card?.subject, 'General');
      const sectionName = normalizeLabel(card?.section_group, 'General');
      const microName = normalizeLabel(card?.microtopic, 'General');

      subjects.add(subjectName);

      if (!sectionsMap[subjectName]) sectionsMap[subjectName] = new Set<string>();
      sectionsMap[subjectName].add(sectionName);

      const sectionKey = buildNodeId(subjectName, sectionName);
      if (!microtopicsMap[sectionKey]) microtopicsMap[sectionKey] = new Set<string>();
      microtopicsMap[sectionKey].add(microName);
    });

    const sectionsObj = Object.fromEntries(
      Object.entries(sectionsMap).map(([subjectName, set]) => [subjectName, Array.from(set)])
    ) as Record<string, string[]>;

    const microsObj = Object.fromEntries(
      Object.entries(microtopicsMap).map(([sectionKey, set]) => [sectionKey, Array.from(set)])
    ) as Record<string, string[]>;

    moveHierarchyRef.current = {
      sectionsMap: sectionsObj,
      microtopicsMap: microsObj,
    };

    const subjectNodes: MoveTreeNode[] = Array.from(subjects)
      .sort((a, b) => a.localeCompare(b))
      .map((subjectName) => ({
        id: subjectName,
        type: 'subject' as const,
        name: subjectName,
        level: 0,
        parentId: null,
        isOpen: false,
        subject: subjectName,
        section_group: 'General',
        microtopic: 'General',
      }));

    let tree = [...subjectNodes];
    const subjectIndex = tree.findIndex((n) => n.subject === currentSubject && n.type === 'subject');
    if (subjectIndex >= 0) {
      tree[subjectIndex] = { ...tree[subjectIndex], isOpen: true };
      const sections = buildSectionNodes(currentSubject);
      tree.splice(subjectIndex + 1, 0, ...sections);

      const sectionIndex = tree.findIndex(
        (n) => n.type === 'section' && n.subject === currentSubject && n.section_group === currentSection
      );
      if (sectionIndex >= 0) {
        tree[sectionIndex] = { ...tree[sectionIndex], isOpen: true };
        const micros = buildMicroNodes(currentSubject, currentSection);
        tree.splice(sectionIndex + 1, 0, ...micros);
      }
    }

    setMoveTree(tree);

    setSelectedMoveTarget({
      subject: currentSubject,
      section_group: currentSection,
      microtopic: currentMicrotopic,
    });
  };

  const toggleMoveNode = (node: MoveTreeNode) => {
    if (node.type === 'microtopic') {
      setSelectedMoveTarget({
        subject: node.subject,
        section_group: node.section_group,
        microtopic: node.microtopic,
      });
      return;
    }

    setMoveTree((prev) => {
      const index = prev.findIndex((n) => n.id === node.id);
      if (index < 0) return prev;

      if (node.isOpen) {
        return prev
          .filter((item) => item.id === node.id || !item.id.startsWith(`${node.id}|`))
          .map((item) => (item.id === node.id ? { ...item, isOpen: false } : item));
      }

      const next = [...prev];
      next[index] = { ...node, isOpen: true };

      const children = node.type === 'subject'
        ? buildSectionNodes(node.subject)
        : buildMicroNodes(node.subject, node.section_group);

      next.splice(index + 1, 0, ...children);
      return next;
    });
  };

  const openMove = async () => {
    if (!menuCard || !session?.user?.id) return;
    setMoveVisible(true);
    setMoveLoading(true);
    try {
      await loadMoveTree();
    } catch (err: any) {
      Alert.alert('Move failed', err?.message || 'Could not load locations');
      setMoveVisible(false);
    } finally {
      setMoveLoading(false);
    }
  };

  const currentLocation: MoveTarget = {
    subject: currentSubject,
    section_group: currentSection,
    microtopic: currentMicrotopic,
  };

  const isSameLocation = !!selectedMoveTarget &&
    selectedMoveTarget.subject === currentLocation.subject &&
    selectedMoveTarget.section_group === currentLocation.section_group &&
    selectedMoveTarget.microtopic === currentLocation.microtopic;

  const moveButtonLabel = selectedMoveTarget
    ? `Move to ${selectedMoveTarget.microtopic}`
    : 'Choose a location';

  const handleMenuAction = async (action: CardMenuAction) => {
    if (!menuCard || !session?.user?.id) return;
    const uid = session.user.id;

    try {
      setMenuBusy(true);

      switch (action) {
        case 'select':
          toggleSelected(menuCard.id);
          closeMenu();
          return;

        case 'edit':
          closeMenu();
          openEdit();
          return;

        case 'freeze':
          await FlashcardSvc.toggleFreeze(uid, menuCard.id, menuCard.status);
          await loadCards();
          closeMenu();
          return;

        case 'move':
          closeMenu();
          await openMove();
          return;

        case 'reverse':
          closeMenu();
          Alert.alert('Reverse card?', 'Front and back will be swapped.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Reverse',
              onPress: async () => {
                try {
                  await FlashcardSvc.reverseCardForUser(uid, menuCard.id);
                  await loadCards();
                } catch (err: any) {
                  Alert.alert('Action failed', err?.message || 'Please try again');
                }
              },
            },
          ]);
          return;

        case 'duplicate':
          await FlashcardSvc.duplicateCardForUser(uid, menuCard.id);
          await loadCards();
          closeMenu();
          return;

        case 'history':
          closeMenu();
          router.push({
            pathname: '/flashcards/history',
            params: { cardId: menuCard.id },
          });
          return;

        case 'delete': {
          const deletedId = menuCard.id;
          closeMenu();
          Alert.alert('Delete card?', 'You can undo immediately.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                try {
                  await FlashcardSvc.softDeleteCardForUser(uid, deletedId);
                  await loadCards();
                  Alert.alert('Deleted', 'Card removed.', [
                    {
                      text: 'Undo',
                      onPress: async () => {
                        try {
                          await FlashcardSvc.restoreDeletedCardForUser(uid, deletedId);
                          await loadCards();
                        } catch (err: any) {
                          Alert.alert('Undo failed', err?.message || 'Please try again');
                        }
                      },
                    },
                    { text: 'OK' },
                  ]);
                } catch (err: any) {
                  Alert.alert('Action failed', err?.message || 'Please try again');
                }
              },
            },
          ]);
          return;
        }
      }
    } catch (err: any) {
      Alert.alert('Action failed', err?.message || 'Please try again');
    } finally {
      setMenuBusy(false);
    }
  };

  const renderCardItem = ({ item }: { item: CardItem }) => {
    const isSelected = selectedIds.has(item.id);

    return (
      <TouchableOpacity
        style={[
          styles.cardItem,
          { backgroundColor: colors.surface, borderColor: isSelected ? colors.primary : colors.border },
          isSelected && { borderWidth: 2 },
        ]}
        onPress={() => {
          if (selectionMode) {
            toggleSelected(item.id);
            return;
          }

          router.push({
            pathname: '/flashcards/review',
            params: { microtopic: currentMicrotopic, subject: currentSubject, section: currentSection, cardId: item.id },
          });
        }}
      >
        <View style={styles.cardTop}>
          {selectionMode ? (
            <View
              style={[
                styles.checkCircle,
                {
                  borderColor: isSelected ? colors.primary : colors.border,
                  backgroundColor: isSelected ? colors.primary : 'transparent',
                },
              ]}
            >
              {isSelected && <Check size={12} color="#fff" />}
            </View>
          ) : (
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    item.learning_status === 'mastered'
                      ? '#34c759'
                      : item.learning_status === 'learning'
                      ? '#3b82f6'
                      : '#94a3b8',
                },
              ]}
            />
          )}

          <Text style={[styles.cardPreview, { color: colors.textPrimary }]} numberOfLines={2}>
            {item.front_text}
          </Text>

          <TouchableOpacity onPress={() => openMenu(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MoreHorizontal size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
        <View style={styles.cardBottom}>
          <Text style={[styles.cardMeta, { color: colors.textTertiary }]}> 
            {item.learning_status.toUpperCase()} • Next: {item.next_review ? new Date(item.next_review).toLocaleDateString() : 'New'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderMoveNode = ({ item }: { item: MoveTreeNode }) => {
    const isLeaf = item.type === 'microtopic';
    const isSelected = !!selectedMoveTarget &&
      item.type === 'microtopic' &&
      selectedMoveTarget.subject === item.subject &&
      selectedMoveTarget.section_group === item.section_group &&
      selectedMoveTarget.microtopic === item.microtopic;

    return (
      <TouchableOpacity
        style={[
          styles.moveRow,
          {
            borderBottomColor: colors.border,
            paddingLeft: 16 + item.level * 34,
            backgroundColor: isSelected ? colors.primary + '18' : 'transparent',
          },
        ]}
        onPress={() => toggleMoveNode(item)}
      >
        {isLeaf ? (
          <View style={[styles.dotBullet, { backgroundColor: colors.textTertiary }]} />
        ) : (
          <View style={[styles.expandCircle, { backgroundColor: colors.surfaceStrong }]}> 
            {item.isOpen ? (
              <Minus size={14} color={colors.textTertiary} />
            ) : (
              <Plus size={14} color={colors.textTertiary} />
            )}
          </View>
        )}

        <Text style={[styles.moveRowText, { color: colors.textPrimary }]} numberOfLines={1}>
          {item.name}
        </Text>

        {isSelected && <Check size={20} color={colors.primary} />}
      </TouchableOpacity>
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
            <Text style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
              {currentMicrotopic}
            </Text>
            <Text style={[styles.headerSub, { color: colors.textTertiary }]}> 
              {currentSubject} • {currentSection}
            </Text>
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={() => setIsAddModalVisible(true)}>
            <Plus size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.statsPanel}>
            <View style={styles.statsRow}>
              <StatItem label="Due" value={stats.due} color={colors.primary} />
              <StatItem label="New" value={stats.new} color={colors.textTertiary} />
              <StatItem label="Learning" value={stats.learning} color="#3b82f6" />
              <StatItem label="Mastered" value={stats.mastered} color="#34c759" />
            </View>

            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${(stats.mastered / (cards.length || 1)) * 100}%`, backgroundColor: '#34c759' },
                  ]}
                />
                <View
                  style={[
                    styles.progressFill,
                    { width: `${(stats.learning / (cards.length || 1)) * 100}%`, backgroundColor: '#3b82f6' },
                  ]}
                />
              </View>
              <Text style={[styles.progressText, { color: colors.textTertiary }]}> 
                {stats.mastered} of {cards.length} cards mastered
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.studyBtn, { backgroundColor: colors.primary }]}
              onPress={() =>
                router.push({
                  pathname: '/flashcards/review',
                  params: { microtopic: currentMicrotopic, subject: currentSubject, section: currentSection },
                })
              }
            >
              <Play size={20} color="#fff" fill="#fff" />
              <Text style={styles.studyBtnText}>Study Cards</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.listSection}>
            {selectionMode && (
              <View style={styles.selectionBar}>
                <Text style={[styles.selectionCount, { color: colors.textSecondary }]}>{selectedIds.size} selected</Text>
                <TouchableOpacity
                  onPress={() => {
                    setSelectionMode(false);
                    setSelectedIds(new Set());
                  }}
                >
                  <Text style={[styles.doneText, { color: colors.primary }]}>Done</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.listHeader}>
              <View style={styles.filterRow}>
                <TouchableOpacity
                  style={[styles.filterChip, filterBy === 'all' && { backgroundColor: colors.primary }]}
                  onPress={() => setFilterBy('all')}
                >
                  <Text style={[styles.filterText, filterBy === 'all' && { color: '#fff' }]}>Active</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, filterBy === 'not_studied' && { backgroundColor: '#94a3b8' }]}
                  onPress={() => setFilterBy('not_studied')}
                >
                  <Text style={[styles.filterText, filterBy === 'not_studied' && { color: '#fff' }]}>New</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, filterBy === 'mastered' && { backgroundColor: '#34c759' }]}
                  onPress={() => setFilterBy('mastered')}
                >
                  <Text style={[styles.filterText, filterBy === 'mastered' && { color: '#fff' }]}>Mastered</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, filterBy === 'frozen' && { backgroundColor: '#ef4444' }]}
                  onPress={() => setFilterBy('frozen')}
                >
                  <Text style={[styles.filterText, filterBy === 'frozen' && { color: '#fff' }]}>Frozen</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.sortBtn} onPress={() => setSortBy(sortBy === 'next' ? 'newest' : 'next')}>
                {sortBy === 'next' ? (
                  <SortAsc size={18} color={colors.textTertiary} />
                ) : (
                  <SortDesc size={18} color={colors.textTertiary} />
                )}
              </TouchableOpacity>
            </View>

            {loading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={filteredAndSortedCards}
                keyExtractor={(item) => item.id}
                renderItem={renderCardItem}
                scrollEnabled={false}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <BookOpen size={48} color={colors.border} />
                    <Text style={{ color: colors.textTertiary, marginTop: 12 }}>No cards match your filter</Text>
                  </View>
                }
              />
            )}
          </View>
        </ScrollView>

        {/* ADD CARDS MODAL */}
        <Modal visible={isAddModalVisible} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: colors.surface, height: '90%' }]}> 
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Add to {currentMicrotopic}</Text>
                <TouchableOpacity onPress={() => setIsAddModalVisible(false)}>
                  <X size={24} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <Text style={{ color: colors.textTertiary, marginBottom: 20 }}> 
                Select questions to convert into flashcards.
              </Text>

              <FlatList
                data={cards.filter((c) => c.learning_status === 'not_studied')}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity style={[styles.selectableItem, { borderColor: colors.border }]}> 
                    <Text style={[styles.selectableText, { color: colors.textPrimary }]} numberOfLines={2}>
                      {item.front_text}
                    </Text>
                    <View style={[styles.checkbox, { borderColor: colors.primary }]} />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={{ textAlign: 'center', marginTop: 40, color: colors.textTertiary }}>
                    No new questions available in this topic.
                  </Text>
                }
              />

              <TouchableOpacity
                style={[styles.studyBtn, { backgroundColor: colors.primary, marginTop: 20 }]}
                onPress={() => setIsAddModalVisible(false)}
              >
                <Text style={styles.studyBtnText}>Add Selected Cards</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <CardOverflowMenu
          visible={menuVisible}
          frozen={menuCard?.status === 'frozen'}
          busy={menuBusy}
          onClose={closeMenu}
          onAction={handleMenuAction}
        />

        {/* EDIT MODAL */}
        <Modal visible={editVisible} transparent animationType="slide" onRequestClose={() => setEditVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: colors.surface, height: '70%' }]}> 
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Edit Card</Text>
                <TouchableOpacity onPress={() => setEditVisible(false)}>
                  <X size={22} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <Text style={{ color: colors.textSecondary, marginBottom: 6 }}>Front</Text>
              <TextInput
                value={editFront}
                onChangeText={setEditFront}
                multiline
                style={[
                  styles.noteInput,
                  { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.bg, height: 120 },
                ]}
              />

              <Text style={{ color: colors.textSecondary, marginBottom: 6, marginTop: 14 }}>Back</Text>
              <TextInput
                value={editBack}
                onChangeText={setEditBack}
                multiline
                style={[
                  styles.noteInput,
                  { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.bg, height: 120 },
                ]}
              />

              <TouchableOpacity
                style={[styles.studyBtn, { backgroundColor: colors.primary, marginTop: 16 }]}
                onPress={async () => {
                  if (!menuCard || !session?.user?.id) return;
                  if (!editFront.trim() || !editBack.trim()) {
                    return Alert.alert('Validation', 'Front and back are required');
                  }

                  try {
                    await FlashcardSvc.updateCardForUser(session.user.id, menuCard.id, {
                      front_text: editFront.trim(),
                      back_text: editBack.trim(),
                    });
                    setEditVisible(false);
                    await loadCards();
                  } catch (err: any) {
                    Alert.alert('Save failed', err?.message || 'Please try again');
                  }
                }}
              >
                <Text style={styles.studyBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* MOVE MODAL */}
        <Modal visible={moveVisible} transparent animationType="slide" onRequestClose={() => setMoveVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: colors.surface, height: '88%' }]}> 
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Select location</Text>
                <TouchableOpacity onPress={() => setMoveVisible(false)}>
                  <X size={22} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              {moveLoading ? (
                <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
              ) : (
                <FlatList
                  data={moveTree}
                  keyExtractor={(item) => item.id}
                  renderItem={renderMoveNode}
                  style={{ flex: 1 }}
                  contentContainerStyle={{ paddingBottom: 16 }}
                />
              )}

              <TouchableOpacity
                style={[
                  styles.studyBtn,
                  {
                    backgroundColor: colors.primary,
                    marginTop: 10,
                    opacity: !selectedMoveTarget || isSameLocation ? 0.5 : 1,
                  },
                ]}
                disabled={!selectedMoveTarget || isSameLocation}
                onPress={async () => {
                  if (!menuCard || !session?.user?.id || !selectedMoveTarget) return;

                  try {
                    await FlashcardSvc.moveCardForUser(session.user.id, menuCard.id, selectedMoveTarget);
                    setMoveVisible(false);
                    await loadCards();
                  } catch (err: any) {
                    Alert.alert('Move failed', err?.message || 'Please try again');
                  }
                }}
              >
                <Text style={styles.studyBtnText} numberOfLines={1}>{moveButtonLabel}</Text>
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
  studyBtn: {
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    elevation: 4,
    paddingHorizontal: 16,
  },
  studyBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  listSection: { flex: 1, paddingHorizontal: 20 },
  selectionBar: { marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectionCount: { fontWeight: '700' },
  doneText: { fontWeight: '800' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: '#f1f5f9' },
  filterText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  sortBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' },
  cardItem: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  checkCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardPreview: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  cardBottom: { marginTop: 10, paddingLeft: 20 },
  cardMeta: { fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', marginTop: 60 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 28, fontWeight: '700' },
  selectableItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
    gap: 12,
  },
  selectableText: { flex: 1, fontSize: 14, fontWeight: '600' },
  checkbox: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  noteInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },

  moveRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    paddingRight: 14,
  },
  expandCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 10,
  },
  moveRowText: {
    flex: 1,
    fontSize: 18,
    fontWeight: '500',
  },
});
