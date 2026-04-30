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
  Animated
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

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface TreeItem {
  id: string;
  name: string;
  type: 'subject' | 'section' | 'microtopic';
  parentId: string | null;
  cardCount: number;
  dueCount: number;
  isOpen: boolean;
  level: number;
}

export default function FlashcardsDashboard() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const userId = session?.user?.id;
  
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, due: 0, mastered: 0, streak: 0, accuracy: 0 });
  const [treeData, setTreeData] = useState<TreeItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  
  const [heatmapData, setHeatmapData] = useState<Record<string, number>>({});
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
    const cacheKey = `flashcards_dashboard_cache_${userId}`;
    
    if (!bypassCache) {
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          setStats(parsed.stats);
          setHeatmapData(parsed.heatmapData);
          setTreeData(parsed.treeData);
          (global as any).rawHierarchy = parsed.rawHierarchy;
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
      const [{ data: cards }, { data: states }, { data: sessions }] = await Promise.all([
        supabase.from('cards').select('id, subject, section_group, microtopic'),
        supabase.from('user_cards').select('*').eq('user_id', userId),
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

      const hierarchy: any = {};
      states?.forEach(state => {
        const c = cards?.find(x => x.id === state.card_id);
        if (!c || state.status === 'deleted') return;

        const sub = c.subject;
        const sec = c.section_group || "General";
        const micro = c.microtopic;
        const isDue = state.status === 'active' && state.learning_status !== 'not_studied' && (!state.next_review || new Date(state.next_review) <= now);

        if (!hierarchy[sub]) hierarchy[sub] = { name: sub, due: 0, total: 0, sections: {} };
        if (!hierarchy[sub].sections[sec]) hierarchy[sub].sections[sec] = { name: sec, due: 0, total: 0, microtopics: {} };
        if (!hierarchy[sub].sections[sec].microtopics[micro]) hierarchy[sub].sections[sec].microtopics[micro] = { name: micro, due: 0, total: 0 };

        if (isDue) {
          hierarchy[sub].due++;
          hierarchy[sub].sections[sec].due++;
          hierarchy[sub].sections[sec].microtopics[micro].due++;
        }
        hierarchy[sub].total++;
        hierarchy[sub].sections[sec].total++;
        hierarchy[sub].sections[sec].microtopics[micro].total++;
      });

      const initialTree: TreeItem[] = Object.keys(hierarchy).sort().map(sub => ({
        id: sub,
        name: sub,
        type: 'subject',
        parentId: null,
        cardCount: hierarchy[sub].total,
        dueCount: hierarchy[sub].due,
        isOpen: false,
        level: 0
      }));

      const newStats = { total: studied, due, mastered, streak: sessions?.length || 0, accuracy };
      setStats(newStats);
      setTreeData(initialTree);
      (global as any).rawHierarchy = hierarchy;

      await AsyncStorage.setItem(cacheKey, JSON.stringify({
        stats: newStats,
        heatmapData: heatmap,
        treeData: initialTree,
        rawHierarchy: hierarchy
      }));

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const toggleNode = (item: TreeItem, forceExpand = false) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    
    if (item.isOpen && !forceExpand) {
      setTreeData(prev => prev.filter(n => {
        if (n.parentId === item.id) return false;
        if (n.parentId && n.parentId.startsWith(item.id + '|')) return false;
        return true;
      }).map(n => n.id === item.id ? { ...n, isOpen: false } : n));
    } else {
      const hierarchy = (global as any).rawHierarchy;
      let children: TreeItem[] = [];
      
      if (item.type === 'subject') {
        const subData = hierarchy[item.id];
        children = Object.keys(subData.sections).sort().map(sec => ({
          id: `${item.id}|${sec}`,
          name: sec,
          type: 'section',
          parentId: item.id,
          cardCount: subData.sections[sec].total,
          dueCount: subData.sections[sec].due,
          isOpen: false,
          level: 1
        }));
      } else if (item.type === 'section') {
        const [sub, sec] = item.id.split('|');
        const secData = hierarchy[sub].sections[sec];
        children = Object.keys(secData.microtopics).sort().map(micro => ({
          id: `${item.id}|${micro}`,
          name: micro,
          type: 'microtopic',
          parentId: item.id,
          cardCount: secData.microtopics[micro].total,
          dueCount: secData.microtopics[micro].due,
          isOpen: false,
          level: 2
        }));
      }

      const index = treeData.findIndex(n => n.id === item.id);
      const next = [...treeData];
      next[index] = { ...item, isOpen: true };
      next.splice(index + 1, 0, ...children);
      setTreeData(next);
    }
  };

  const openDeckView = (item: TreeItem) => {
    const params: any = { subject: '', section: '', microtopic: '' };
    if (item.type === 'subject') {
      params.subject = item.name;
    } else if (item.type === 'section') {
      params.subject = item.id.split('|')[0];
      params.section = item.name;
    } else if (item.type === 'microtopic') {
      const parts = item.id.split('|');
      params.subject = parts[0];
      params.section = parts[1];
      params.microtopic = item.name;
    }
    router.push({ pathname: '/flashcards/microtopic', params });
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

  const renderTreeItem = ({ item }: { item: TreeItem }) => {
    const isSubject = item.type === 'subject';
    const isMicro = item.type === 'microtopic';
    const paddingLeft = item.level * 32 + 20;
    const hasChildren = !isMicro;

    return (
      <View key={item.id} style={styles.treeRowContainer}>
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
        
        <View style={[styles.treeRow, { paddingLeft }]}>
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
              { color: colors.textPrimary, fontSize: isSubject ? 20 : 16, fontWeight: isSubject ? '800' : '700' }
            ]}>
              {item.name}
            </Text>
            <Text style={[styles.nodeSub, { color: colors.textTertiary }]}>
              Cards for today: <Text style={{ fontWeight: '800', color: item.dueCount > 0 ? colors.primary : colors.textTertiary }}>{item.dueCount}</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>
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
                <TouchableOpacity><Filter size={16} color={colors.textTertiary} /></TouchableOpacity>
              </View>

              <View style={{ paddingBottom: 100 }}>
                {treeData.map(item => renderTreeItem({ item }))}
              </View>
            </Animated.View>
          )}
        </ScrollView>
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
  nodeSub: { fontSize: 12, marginTop: 2 }
});
