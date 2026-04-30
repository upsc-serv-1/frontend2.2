import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  SafeAreaView, 
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
  TextInput,
  Animated,
  Modal,
  Alert
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  Layers, 
  Play, 
  ChevronRight, 
  Filter, 
  Search, 
  Plus, 
  Clock, 
  Flame,
  Snowflake,
  Search as SearchIcon,
  X,
  Check
} from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';
import { ThemeSwitcher } from '../src/components/ThemeSwitcher';
import { PageWrapper } from '../src/components/PageWrapper';
import { Swipeable } from 'react-native-gesture-handler';
import { FlashcardBranchService, BranchNode } from '../src/services/FlashcardBranchService';
import { 
  Trash2, 
  Archive, 
  CornerUpRight, 
  FolderPlus,
  Eye,
  EyeOff
} from 'lucide-react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface TreeItem {
  id: string;
  name: string;
  type: 'branch';
  parentId: string | null;
  cardCount: number;
  dueCount: number;
  isOpen: boolean;
  level: number;
  is_archived: boolean;
  children?: BranchNode[];
}

export default function FlashcardsDashboard() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const userId = session?.user?.id;
  
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, due: 0, mastered: 0, streak: 0, accuracy: 0 });
  const [treeData, setTreeData] = useState<TreeItem[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  
  const [heatmapData, setHeatmapData] = useState<Record<string, number>>({});
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [isMoveModalVisible, setIsMoveModalVisible] = useState(false);
  const [selectedNode, setSelectedNode] = useState<TreeItem | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      if (userId) loadData();
    }, [userId])
  );

  useEffect(() => {
    if (!loading) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  }, [loading]);

  const loadData = async (bypassCache = false) => {
    if (!userId) return;
    const cacheKey = `flashcards_dashboard_cache_${userId}`;
    
    // 1. Initial Load from Cache
    if (!bypassCache) {
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          setStats(parsed.stats);
          setHeatmapData(parsed.heatmapData);
          setTreeData(parsed.treeData);
        } else {
          setLoading(true);
        }
      } catch (e) {
        setLoading(true);
      }
    } else {
      setLoading(true);
    }

    try {
      // 2. Bootstrap & Fetch Tree
      await FlashcardBranchService.bootstrapIfEmpty(userId);
      const branches = await FlashcardBranchService.getTree(userId, { includeArchived: showArchived });
      
      // 3. Fetch Stats & Heatmap
      const [{ data: states }, { data: sessions }] = await Promise.all([
        supabase.from('user_cards').select('status, learning_status, next_review').eq('user_id', userId),
        supabase.from('study_sessions').select('*').eq('user_id', userId).order('date', { ascending: false }).limit(30)
      ]);
      
      const now = new Date();
      const studied = states?.length || 0;
      const due = states?.filter(c => 
        c.status === 'active' && 
        c.learning_status !== 'not_studied' && 
        (!c.next_review || new Date(c.next_review) <= now)
      ).length || 0;
      
      const mastered = states?.filter(c => c.learning_status === 'mastered').length || 0;
      const accuracy = studied > 0 ? Math.round((mastered / studied) * 100) : 0;

      const heatmap: Record<string, number> = {};
      sessions?.forEach(s => heatmap[s.date] = s.cards_reviewed);
      setHeatmapData(heatmap);
      setStats({ total: studied, due, mastered, streak: 0, accuracy });

      // 4. Transform branches to Flat Tree for FlatList
      const flatten = (nodes: BranchNode[], level = 0): TreeItem[] => {
        const result: TreeItem[] = [];
        nodes.forEach(node => {
          result.push({
            id: node.id,
            name: node.name,
            type: 'branch',
            parentId: node.parent_id,
            cardCount: node.cardCount || 0,
            dueCount: 0, // TODO: Implement due count per branch if needed
            isOpen: false,
            level: node.level || level,
            is_archived: node.is_archived,
            children: node.children
          });
        });
        return result;
      };

      const topLevel = flatten(branches);
      setTreeData(topLevel);

      // Save to cache
      await AsyncStorage.setItem(cacheKey, JSON.stringify({
        stats: { total: studied, due, mastered, streak: 0, accuracy },
        heatmapData: heatmap,
        treeData: topLevel
      }));

    } catch (err) {
      console.error('Load data error:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleNode = (item: TreeItem, forceExpand = false) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    
    if (item.isOpen && !forceExpand) {
      // Close node: remove all descendants
      const removeIds = new Set<string>();
      const collectIds = (nodes: any[]) => {
        nodes.forEach(n => {
          removeIds.add(n.id);
          if (n.children) collectIds(n.children);
        });
      };
      if (item.children) collectIds(item.children);

      setTreeData(prev => prev.filter(n => !removeIds.has(n.id)).map(n => n.id === item.id ? { ...n, isOpen: false } : n));
    } else {
      // Open node: insert immediate children
      if (!item.children || item.children.length === 0) {
        setTreeData(prev => prev.map(n => n.id === item.id ? { ...n, isOpen: true } : n));
        return;
      }

      const children: TreeItem[] = item.children.map(child => ({
        id: child.id,
        name: child.name,
        type: 'branch',
        parentId: item.id,
        cardCount: child.cardCount || 0,
        dueCount: 0,
        isOpen: false,
        level: (item.level || 0) + 1,
        is_archived: child.is_archived,
        children: child.children
      }));

      const index = treeData.findIndex(n => n.id === item.id);
      const next = [...treeData];
      next[index] = { ...item, isOpen: true };
      next.splice(index + 1, 0, ...children);
      setTreeData(next);
    }
  };

  const openDeckView = (item: TreeItem) => {
    router.push({ 
      pathname: '/flashcards/microtopic', 
      params: { branchId: item.id, name: item.name } 
    });
  };

  const renderHeatmap = () => {
    // Show last 21 days
    const cells = [];
    const now = new Date();
    
    for (let i = 20; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const val = heatmapData[dateStr] || 0;
      
      let cellColor = colors.surfaceStrong;
      if (val > 0) cellColor = `${colors.primary}30`;
      if (val > 10) cellColor = `${colors.primary}60`;
      if (val > 25) cellColor = `${colors.primary}90`;
      if (val > 50) cellColor = colors.primary;
      
      cells.push(
        <View 
          key={dateStr} 
          style={[styles.heatmapCell, { backgroundColor: cellColor }]} 
        />
      );
    }

    return (
      <View style={[styles.heatmapBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.heatmapHeader}>
          <Flame size={16} color="#f97316" />
          <Text style={[styles.heatmapTitle, { color: colors.textSecondary }]}>Study Consistency</Text>
        </View>
        <View style={styles.heatmapGrid}>
          {cells}
        </View>
      </View>
    );
  };

  const renderRightActions = (item: TreeItem) => {
    return (
      <View style={styles.rightActions}>
        <TouchableOpacity 
          style={[styles.actionSquare, { backgroundColor: colors.surfaceStrong }]}
          onPress={() => {
            swipeableRefs.current[item.id]?.close();
            setSelectedNode(item);
            setNewBranchName("");
            setIsCreateModalVisible(true);
          }}
        >
          <Plus size={18} color={colors.primary} />
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.actionSquare, { backgroundColor: colors.surfaceStrong }]}
          onPress={() => {
            swipeableRefs.current[item.id]?.close();
            setSelectedNode(item);
            setIsMoveModalVisible(true);
          }}
        >
          <CornerUpRight size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.actionSquare, { backgroundColor: colors.surfaceStrong }]}
          onPress={async () => {
            swipeableRefs.current[item.id]?.close();
            await FlashcardBranchService.updateBranch(userId!, item.id, { is_archived: !item.is_archived });
            loadData(true);
          }}
        >
          <Archive size={18} color={item.is_archived ? colors.primary : colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.actionSquare, { backgroundColor: '#fee2e2' }]}
          onPress={async () => {
            swipeableRefs.current[item.id]?.close();
            Alert.alert("Delete Branch", "This will hide this branch and its sub-branches. Global cards remain in deck.", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: async () => {
                await FlashcardBranchService.deleteBranch(userId!, item.id);
                loadData(true);
              }}
            ]);
          }}
        >
          <Trash2 size={18} color="#ef4444" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderTreeItem = ({ item }: { item: TreeItem }) => {
    const isMicro = !item.children || item.children.length === 0;
    const paddingLeft = item.level * 32 + 20;
    const hasChildren = item.children && item.children.length > 0;

    return (
      <Swipeable
        key={item.id}
        ref={ref => swipeableRefs.current[item.id] = ref}
        renderRightActions={() => renderRightActions(item)}
        friction={2}
        rightThreshold={40}
      >
        <View style={styles.treeRowContainer}>
          {item.level > 0 && (
            <View style={[
              styles.vLine, 
              { 
                left: (item.level - 1) * 32 + 34, 
                backgroundColor: colors.border,
                top: -14,
                bottom: item.isOpen ? 0 : 20 
              }
            ]} />
          )}
          
          <View style={[styles.treeRow, { paddingLeft, backgroundColor: colors.bg }]}>
            {hasChildren ? (
              <TouchableOpacity 
                onPress={() => toggleNode(item)}
                style={[styles.expandBtn, { backgroundColor: colors.surfaceStrong }]}
              >
                {item.isOpen ? <X size={14} color={colors.textPrimary} /> : <Plus size={14} color={colors.textPrimary} />}
              </TouchableOpacity>
            ) : (
              <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
                 <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.textTertiary }} />
              </View>
            )}

            <TouchableOpacity 
              style={styles.nodeContent} 
              onPress={() => openDeckView(item)}
            >
              <Text style={[
                styles.nodeName, 
                { color: item.isOpen ? colors.primary : colors.textPrimary },
                item.is_archived && { color: colors.textTertiary, fontStyle: 'italic' }
              ]}>
                {item.name}
              </Text>
              <Text style={[styles.nodeSub, { color: colors.textTertiary }]}>
                {item.cardCount} cards • {item.is_archived ? 'Archived' : 'Active'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Swipeable>
    );
  };

  return (
    <PageWrapper>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        <ScrollView stickyHeaderIndices={[0]} showsVerticalScrollIndicator={false}>
          <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <View style={styles.headerTop}>
              <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Deck Hub</Text>
              <View style={styles.headerBtns}>
                <TouchableOpacity onPress={() => router.push('/flashcards/new')} style={styles.iconBtn}><Plus size={22} color={colors.textPrimary} /></TouchableOpacity>
                <TouchableOpacity onPress={() => setIsSearchVisible(!isSearchVisible)} style={styles.iconBtn}><SearchIcon size={22} color={colors.textPrimary} /></TouchableOpacity>
                <ThemeSwitcher />
              </View>
            </View>
            
            {isSearchVisible && (
              <View style={[styles.searchBar, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <SearchIcon size={18} color={colors.textTertiary} />
                <TextInput style={[styles.searchInput, { color: colors.textPrimary }]} placeholder="Search subjects, microtopics..." placeholderTextColor={colors.textTertiary} autoFocus value={searchQuery} onChangeText={setSearchQuery} />
                <TouchableOpacity onPress={() => setIsSearchVisible(false)}><X size={18} color={colors.textTertiary} /></TouchableOpacity>
              </View>
            )}
          </View>

          {loading && treeData.length === 0 ? (
            <View style={{ flex: 1, padding: 100, alignItems: 'center' }}>
               <ActivityIndicator size="large" color={colors.primary} />
               <Text style={{ color: colors.textSecondary, marginTop: 16, fontWeight: '600' }}>Preparing Decks...</Text>
            </View>
          ) : (
            <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
              <View style={styles.statsPanel}>
                <View style={[styles.statsGrid, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.statItem}><Text style={[styles.statValue, { color: colors.primary }]}>{stats.due}</Text><Text style={[styles.statLabel, { color: colors.textTertiary }]}>Due</Text></View>
                  <View style={styles.statItem}><Text style={[styles.statValue, { color: '#34c759' }]}>{stats.accuracy}%</Text><Text style={[styles.statLabel, { color: colors.textTertiary }]}>Accuracy</Text></View>
                  <View style={styles.statItem}><Text style={[styles.statValue, { color: '#f97316' }]}>{stats.streak}d</Text><Text style={[styles.statLabel, { color: colors.textTertiary }]}>Streak</Text></View>
                </View>
                <View style={styles.actionRow}>
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary }]} onPress={() => router.push({ pathname: '/flashcards/review', params: { mode: 'due' } })}>
                    <Clock size={16} color="#fff" /><Text style={styles.actionBtnText}>Revise Due</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.border }]} onPress={() => router.push({ pathname: '/flashcards/review', params: { mode: 'all' } })}>
                    <Layers size={16} color={colors.textPrimary} /><Text style={[styles.actionBtnText, { color: colors.textPrimary }]}>Revise All</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.insightsSection}>
                {renderHeatmap()}
                <TouchableOpacity style={[styles.frozenBtn, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]} onPress={() => router.push('/flashcards/frozen')}>
                  <Snowflake size={18} color={colors.primary} />
                  <Text style={[styles.frozenBtnText, { color: colors.primary }]}>View Frozen Cards</Text>
                  <ChevronRight size={18} color={colors.primary} />
                </TouchableOpacity>
              </View>

              <View style={[styles.treeHeader, { backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                <Text style={[styles.treeHeaderTitle, { color: colors.textTertiary }]}>SUBJECT HIERARCHY</Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity onPress={() => {
                    setShowArchived(!showArchived);
                    loadData(true);
                  }}>
                    {showArchived ? <Eye size={18} color={colors.primary} /> : <EyeOff size={18} color={colors.textTertiary} />}
                  </TouchableOpacity>
                  <TouchableOpacity><Filter size={18} color={colors.textTertiary} /></TouchableOpacity>
                </View>
              </View>

              <View style={{ paddingBottom: 100 }}>
                {treeData.map(item => renderTreeItem({ item }))}
              </View>
            </Animated.View>
          )}
        </ScrollView>

        {/* Create Branch Modal */}
        <Modal visible={isCreateModalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Create Child Branch</Text>
              <Text style={[styles.modalSub, { color: colors.textTertiary }]}>Adding under: {selectedNode?.name}</Text>
              <TextInput 
                style={[styles.modalInput, { color: colors.textPrimary, borderColor: colors.border }]}
                placeholder="Branch Name"
                placeholderTextColor={colors.textTertiary}
                value={newBranchName}
                onChangeText={setNewBranchName}
                autoFocus
              />
              <View style={styles.modalActions}>
                <TouchableOpacity onPress={() => setIsCreateModalVisible(false)} style={styles.modalBtn}>
                  <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={async () => {
                    if (!newBranchName.trim()) return;
                    await FlashcardBranchService.createBranch(userId!, newBranchName.trim(), selectedNode?.id);
                    setIsCreateModalVisible(false);
                    loadData(true);
                  }} 
                  style={[styles.modalBtn, { backgroundColor: colors.primary }]}
                >
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Move Branch Modal - Simplified for now, can be expanded to a tree picker */}
        <Modal visible={isMoveModalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Move Branch</Text>
              <Text style={[styles.modalSub, { color: colors.textTertiary }]}>Moving: {selectedNode?.name}</Text>
              <ScrollView style={{ maxHeight: 300, marginVertical: 12 }}>
                <TouchableOpacity 
                  style={[styles.moveOption, { borderBottomColor: colors.border }]}
                  onPress={async () => {
                    await FlashcardBranchService.moveBranch(userId!, selectedNode!.id, null);
                    setIsMoveModalVisible(false);
                    loadData(true);
                  }}
                >
                  <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>Move to Top Level</Text>
                </TouchableOpacity>
                {treeData.filter(n => n.id !== selectedNode?.id && n.level < 2).map(node => (
                  <TouchableOpacity 
                    key={node.id}
                    style={[styles.moveOption, { borderBottomColor: colors.border }]}
                    onPress={async () => {
                      await FlashcardBranchService.moveBranch(userId!, selectedNode!.id, node.id);
                      setIsMoveModalVisible(false);
                      loadData(true);
                    }}
                  >
                    <Text style={{ color: colors.textPrimary, marginLeft: node.level * 12 }}>{node.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity onPress={() => setIsMoveModalVisible(false)} style={styles.modalBtn}>
                <Text style={{ color: colors.textSecondary, textAlign: 'center', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </PageWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { borderBottomWidth: 1 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  headerTitle: { fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  headerBtns: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 16, paddingHorizontal: 16, height: 44, borderRadius: 22, borderWidth: 1, gap: 10 },
  searchInput: { flex: 1, fontSize: 14 },
  statsPanel: { paddingHorizontal: 20, paddingVertical: 20 },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, padding: 16, borderRadius: 20, borderWidth: 1 },
  statItem: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 22, fontWeight: '900' },
  statLabel: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginTop: 2, letterSpacing: 0.5 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, height: 44, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  insightsSection: { padding: 20, gap: 16 },
  heatmapBox: { padding: 16, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  heatmapHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  heatmapTitle: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  heatmapGrid: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  heatmapCell: { width: 14, height: 14, borderRadius: 3 },
  frozenBtn: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 },
  frozenBtnText: { flex: 1, fontSize: 15, fontWeight: '700' },
  treeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  treeHeaderTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  treeRowContainer: { position: 'relative' },
  vLine: { position: 'absolute', top: 0, bottom: 0, width: 1.5, zIndex: -1 },
  treeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingRight: 20 },
  expandBtn: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  nodeContent: { flex: 1, marginLeft: 12 },
  nodeName: { fontSize: 16, fontWeight: '700' },
  nodeSub: { fontSize: 12, marginTop: 2 },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
    gap: 4
  },
  actionSquare: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  modalContent: {
    width: '100%',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 8
  },
  modalSub: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 20
  },
  modalInput: {
    height: 50,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 24
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12
  },
  modalBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center'
  },
  moveOption: {
    paddingVertical: 14,
    borderBottomWidth: 1,
  }
});
