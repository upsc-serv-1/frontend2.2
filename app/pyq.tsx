import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  ChevronDown,
  ChevronLeft,
  Download,
  Grid,
  LineChart as LineIcon,
  TrendingUp,
  X,
} from 'lucide-react-native';
import { supabase } from '../src/lib/supabase';
import { PieChart, LineChart } from '../src/components/Charts';
import { useTheme } from '../src/context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { prelimsTaxonomy } from '../src/data/taxonomy';

const { width } = Dimensions.get('window');

const EXAM_STAGES = ['Prelims', 'Mains'];
const PAPERS = {
  Prelims: ['GS Paper 1', 'GS Paper 2 (CSAT)'],
  Mains: ['GS Paper 1', 'GS Paper 2', 'GS Paper 3', 'GS Paper 4', 'Optional'],
};
const RANGE_OPTIONS = ['Only 2025', 'Last 5 Years', 'Last 10 Years', 'All (2013-2025)', 'Custom Range'];
const TREND_PALETTE = ['#2563eb', '#14b8a6', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899'];
const PYQ_PAGE_SIZE = 1000;

type HubKey = 'overview' | 'heatmaps' | 'focused';
type ExportMode = 'all' | 'momentum' | 'distribution' | 'heatmaps' | 'focused' | 'subject_one' | 'subject_all';

type HeatmapRow = {
  key: string;
  label: string;
  byYear: Record<string, number>;
};

// Reduced width by 30% (from 132 to 92)
const HEATMAP_LABEL_WIDTH = 92;
const HEATMAP_CELL_WIDTH = 48;
const HEATMAP_ROW_HEIGHT = 38;
const HEATMAP_MAX_BODY_HEIGHT = 360;

function StickyHeatmapTable({
  title,
  labelHeader,
  years,
  rows,
  baseColor,
  maxOpacityDivisor,
  colors,
  onCellPress,
  heatmapPalette,
}: {
  title: string;
  labelHeader: string;
  years: string[];
  rows: HeatmapRow[];
  baseColor: string;
  maxOpacityDivisor: number;
  colors: any;
  onCellPress?: (rowLabel: string, year: string) => void;
  heatmapPalette: 'spectral' | 'ocean';
}) {
  const headerRef = useRef<ScrollView | null>(null);

  const handleBodyHorizontalScroll = (x: number) => {
    headerRef.current?.scrollTo({ x, animated: false });
  };

  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
      <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>{title}</Text>
      {rows.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.textSecondary, paddingVertical: 16 }]}>No heatmap data available.</Text>
      ) : (
        <View style={[styles.heatmapFrame, { borderColor: colors.border }]}> 
          <View style={[styles.heatmapStickyHeaderRow, { borderBottomColor: colors.border, backgroundColor: colors.surfaceStrong }]}> 
            <View style={[styles.heatmapStickyLabelHeader, { borderRightColor: colors.border }]}> 
              <Text style={[styles.heatmapLabelHeaderText, { color: colors.textTertiary }]}>{labelHeader}</Text>
            </View>
            <ScrollView
              horizontal
              ref={headerRef}
              scrollEnabled={false}
              showsHorizontalScrollIndicator={false}
            >
              <View style={styles.heatmapYearHeaderTrack}>
                {years.map((year) => (
                  <View key={`header-${labelHeader}-${year}`} style={[styles.heatmapYearHeaderCell, { borderRightColor: colors.border }]}> 
                    <Text style={[styles.heatmapYearHeaderText, { color: colors.textTertiary }]}>{year}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          <ScrollView style={styles.heatmapBodyScroll} nestedScrollEnabled>
            <View style={styles.heatmapBodyLayout}>
              <View style={[styles.heatmapStickyLabelColumn, { borderRightColor: colors.border }]}> 
                {rows.map((row) => (
                  <TouchableOpacity 
                    key={`label-${row.key}`} 
                    style={[styles.heatmapStickyLabelCell, { borderBottomColor: colors.border + '55' }]}
                    onPress={() => Alert.alert(labelHeader, row.label)}
                    activeOpacity={0.7}
                  > 
                    <Text style={[styles.heatmapStickyLabelText, { color: colors.textSecondary }]} numberOfLines={1}>
                      {row.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator
                onScroll={(event) => handleBodyHorizontalScroll(event.nativeEvent.contentOffset.x)}
                scrollEventThrottle={16}
              >
                <View>
                  {rows.map((row) => (
                    <View key={`data-${row.key}`} style={[styles.heatmapDataRow, { borderBottomColor: colors.border + '55' }]}> 
                      {years.map((year) => {
                        const count = row.byYear[year] || 0;
                        const cappedCount = Math.min(count, 22);
                        let bgColor = colors.surfaceStrong;
                        let textColor = colors.textTertiary;
                        let opacity = 1;

                        if (count > 0) {
                          const ratio = (cappedCount - 1) / 21;
                          if (heatmapPalette === 'spectral') {
                            // Spectral: Yellow-Green to Deep Blue
                            const h = 70 + (ratio * 155);
                            const s = 65 + (ratio * 20);
                            const l = 85 - (ratio * 55);
                            bgColor = `hsl(${h}, ${s}%, ${l}%)`;
                            textColor = l < 55 ? '#ffffff' : '#065f46';
                          } else {
                            // Ocean: Light Blue to Deep Navy
                            const h = 210 + (ratio * 15); // Stays in blue range
                            const s = 60 + (ratio * 35); // Gets more saturated
                            const l = 90 - (ratio * 65); // Gets much darker
                            bgColor = `hsl(${h}, ${s}%, ${l}%)`;
                            textColor = l < 55 ? '#ffffff' : '#1e3a8a';
                          }
                        } else {
                          opacity = 0.4;
                        }

                        return (
                          <TouchableOpacity
                            key={`${row.key}-${year}`}
                            style={[
                              styles.heatmapDataCell, 
                              { 
                                backgroundColor: bgColor, 
                                opacity,
                                borderRadius: 6,
                                margin: 1,
                                width: HEATMAP_CELL_WIDTH - 2,
                                height: HEATMAP_ROW_HEIGHT - 2,
                              }
                            ]}
                            onPress={() => onCellPress?.(row.label, year)}
                          >
                            <Text style={[styles.heatCellText, { color: textColor, fontSize: 10, fontWeight: '800' }]}>{count || ''}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

export default function PyqAnalysisTab({ isEmbedded }: { isEmbedded?: boolean }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const taxonomyMaps = useMemo(() => {
    const microToSubject: Record<string, string> = {};
    const sectionToSubject: Record<string, string> = {};
    prelimsTaxonomy.forEach(entry => {
      if (entry.microTopic) microToSubject[entry.microTopic.trim().toLowerCase()] = entry.subject;
      if (entry.sectionGroup) sectionToSubject[entry.sectionGroup.trim().toLowerCase()] = entry.subject;
    });
    return { microToSubject, sectionToSubject };
  }, []);

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [examStage, setExamStage] = useState('Prelims');
  const [selectedPaper, setSelectedPaper] = useState('GS Paper 1');
  const [selectedRange, setSelectedRange] = useState('Last 10 Years');
  const [customYearStart, setCustomYearStart] = useState('2020');
  const [customYearEnd, setCustomYearEnd] = useState('2025');
  const [activeHub, setActiveHub] = useState<HubKey>('overview');
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'stage' | 'paper' | 'range' | null>(null);
  const [exportModalVisible, setExportModalVisible] = useState(false);

  const [rawQuestions, setRawQuestions] = useState<any[]>([]);
  const [testsMetaById, setTestsMetaById] = useState<Record<string, any>>({});
  const [distributionData, setDistributionData] = useState<Array<{ name: string; value: number }>>([]);
  const [heatmapData, setHeatmapData] = useState<Record<string, Record<string, number>>>({});
  const [topicYearHeatmap, setTopicYearHeatmap] = useState<Record<string, Record<string, number>>>({});
  const [topTopics, setTopTopics] = useState<string[]>([]);
  const [trendSubjects, setTrendSubjects] = useState<string[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [heatmapSubject, setHeatmapSubject] = useState<string>('All');
  const [sectionData, setSectionData] = useState<Array<{ name: string; value: number }>>([]);
  const [microTopicData, setMicroTopicData] = useState<Array<{ name: string; value: number }>>([]);
  const [focusSubject, setFocusSubject] = useState('All');
  const [focusSection, setFocusSection] = useState('All');
  const [focusMicro, setFocusMicro] = useState('All');
  const [exportSubject, setExportSubject] = useState('');
  const [heatmapPalette, setHeatmapPalette] = useState<'spectral' | 'ocean'>('spectral');

  // Fade animation
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fetchPyqData();
  }, [examStage, selectedPaper, selectedRange, customYearStart, customYearEnd]);

  useEffect(() => {
    if (!loading) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    } else {
      fadeAnim.setValue(0);
    }
  }, [loading]);

  const getAnalyticsSubject = (q: any) => {
    const micro = String(q.micro_topic || '').trim();
    const section = String(q.section_group || '').trim();
    const rawSubject = String(q.subject || '').trim();
    const lowerSubject = rawSubject.toLowerCase();

    if (micro && taxonomyMaps.microToSubject[micro.toLowerCase()]) {
      return taxonomyMaps.microToSubject[micro.toLowerCase()];
    }
    if (section && taxonomyMaps.sectionToSubject[section.toLowerCase()]) {
      return taxonomyMaps.sectionToSubject[section.toLowerCase()];
    }

    const isCsat = /(^|\b)(csat|aptitude|comprehension|logical reasoning|maths|numeracy|paper\s*ii|paper\s*2)(\b|$)/i.test(`${rawSubject} ${section}`);
    if (isCsat) return 'CSAT';
    if (rawSubject && taxonomyMaps.sectionToSubject[lowerSubject]) {
      return taxonomyMaps.sectionToSubject[lowerSubject];
    }
    return rawSubject || 'Miscellaneous';
  };

  const getAnalyticsYear = (q: any) => {
    const test = testsMetaById[String(q.test_id)] || {};
    const y = q.exam_year || q.year || q.launch_year || q.source?.year || test.launch_year || test.exam_year;
    const num = parseInt(String(y), 10);
    return Number.isFinite(num) && num > 1900 ? num : null;
  };

  const parseYearRange = () => {
    const start = parseInt(customYearStart, 10);
    const end = parseInt(customYearEnd, 10);
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  };

  const extractYearFromTitle = (value: string) => {
    const match = String(value || '').match(/(20\d{2})/);
    return match ? parseInt(match[1], 10) : null;
  };

  const normalizePyqPaperGroup = (value = '', fallbackStage = '') => {
    const text = String(value || '').trim().toLowerCase();
    const stage = String(fallbackStage || '').trim().toLowerCase();
    if (!text) return '';
    if (text === 'gs paper 1' || text === 'paper 1' || text === 'gs1' || text === 'pre_gs1' || text.includes('gs paper 1')) return 'GS Paper 1';
    if (text === 'csat' || text === 'gs paper 2' || text === 'paper 2' || text === 'gs2' || text === 'pre_csat' || text.includes('csat') || text.includes('paper 2') || (text === 'pre_gs2' && stage.includes('prelim'))) return 'GS Paper 2';
    if (text === 'gs paper 3' || text === 'paper 3' || text === 'gs3') return 'GS Paper 3';
    if (text === 'gs paper 4' || text === 'paper 4' || text === 'gs4') return 'GS Paper 4';
    return String(value || '').trim();
  };

  const resolveTestPaperGroup = (test: any) =>
    normalizePyqPaperGroup(
      test.section_group || test.sectionGroup || test.level || test.title || '',
      test.level || test.series || ''
    );

  const getTestYear = (test: any) => {
    const num = Number(test?.launch_year || test?.exam_year || extractYearFromTitle(test?.title || ''));
    return Number.isFinite(num) && num > 1900 ? num : null;
  };

  const matchesYearRange = (year: number | null) => {
    if (!year) return false;
    if (selectedRange === 'Only 2025') return year === 2025;
    if (selectedRange === 'Last 5 Years') return year >= 2021;
    if (selectedRange === 'Last 10 Years') return year >= 2016;
    if (selectedRange === 'Custom Range') {
      const range = parseYearRange();
      if (!range) return true;
      return year >= range.start && year <= range.end;
    }
    return true;
  };

  const fetchQuestionsForTests = async (testIds: string[]) => {
    const rows: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .in('test_id', testIds)
        .order('test_id', { ascending: true })
        .order('question_number', { ascending: true })
        .range(from, from + PYQ_PAGE_SIZE - 1);
      if (error) throw error;
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < PYQ_PAGE_SIZE) break;
      from += PYQ_PAGE_SIZE;
    }
    return rows;
  };

  const fetchPyqData = async (bypassCache = false) => {
    const stageNorm = examStage.toLowerCase();
    const targetPaperGroup = normalizePyqPaperGroup(selectedPaper, examStage);
    const cacheKey = `pyq_cache_${stageNorm}_${targetPaperGroup.replace(/\s+/g, '_')}_${selectedRange.replace(/\s+/g, '_')}`;

    if (!bypassCache) {
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          setRawQuestions(parsed.questions || []);
          setTestsMetaById(parsed.testsMeta || {});
          processAnalytics(parsed.questions || []);
          // Optional: skip network if cache is very fresh (e.g. < 24h)
        } else {
          setLoading(true);
        }
      } catch (e) {
        setLoading(true);
      }
    }

    try {
      const { data: tests, error: testError } = await supabase
        .from('tests')
        .select('id, title, subject, level, paper_type, section_group, exam_year, launch_year, institute, program_id, program_name, series');
      if (testError) throw testError;
      const relevantTests = (tests || []).filter((test: any) => {
        const institute = String(test.institute || '').trim().toLowerCase();
        const programId = String(test.program_id || '').trim().toLowerCase();
        const programName = String(test.program_name || '').trim().toLowerCase();
        const series = String(test.series || '').trim().toLowerCase();
        const paperType = String(test.paper_type || '').trim().toLowerCase();

        if (institute !== 'upsc') return false;
        if (programId !== 'cse' && programName !== 'cse') return false;
        if (series !== 'prelims (official)') return false;
        if (paperType && !['test-paper', 'question bank'].includes(paperType)) return false;
        if (stageNorm !== 'prelims') return false;
        return resolveTestPaperGroup(test) === targetPaperGroup;
      });
      const visibleTests = relevantTests.filter((test: any) => matchesYearRange(getTestYear(test)));

      if (visibleTests.length === 0) {
        clearComputedState();
        setRawQuestions([]);
        setTestsMetaById({});
        return;
      }

      const testIds = visibleTests.map((test: any) => test.id);
      const testsMetaMap = Object.fromEntries(visibleTests.map((test: any) => [String(test.id), test]));
      const questions = await fetchQuestionsForTests(testIds);
      
      setRawQuestions(questions);
      setTestsMetaById(testsMetaMap);
      processAnalytics(questions);

      // Save to cache
      await AsyncStorage.setItem(cacheKey, JSON.stringify({
        questions,
        testsMeta: testsMetaMap,
        timestamp: Date.now()
      }));

    } catch (err) {
      console.error('PYQ analysis fetch error', err);
      if (!bypassCache) { // Only clear if we didn't have cache to begin with
        clearComputedState();
        setRawQuestions([]);
        setTestsMetaById({});
      }
    } finally {
      setLoading(false);
    }
  };

  const clearComputedState = () => {
    setDistributionData([]);
    setHeatmapData({});
    setTopicYearHeatmap({});
    setTopTopics([]);
    setTrendSubjects([]);
    setSelectedSubject(null);
    setSelectedSection(null);
    setHeatmapSubject('All');
    setSectionData([]);
    setMicroTopicData([]);
  };

  const processAnalytics = (data: any[]) => {
    if (!data.length) {
      clearComputedState();
      return;
    }

    const subjectMap: Record<string, number> = {};
    const yearSubjectMap: Record<string, Record<string, number>> = {};
    const topicMap: Record<string, number> = {};
    const topicYearMap: Record<string, Record<string, number>> = {};

    data.forEach(q => {
      const subject = getAnalyticsSubject(q);
      const year = getAnalyticsYear(q);
      if (!year) return;
      const yearKey = String(year);

      subjectMap[subject] = (subjectMap[subject] || 0) + 1;
      if (!yearSubjectMap[yearKey]) yearSubjectMap[yearKey] = {};
      yearSubjectMap[yearKey][subject] = (yearSubjectMap[yearKey][subject] || 0) + 1;

      const topic = q.micro_topic || q.section_group || 'Other';
      topicMap[topic] = (topicMap[topic] || 0) + 1;
      if (!topicYearMap[topic]) topicYearMap[topic] = {};
      topicYearMap[topic][yearKey] = (topicYearMap[topic][yearKey] || 0) + 1;
    });

    const sortedSubjects = Object.entries(subjectMap).sort((a, b) => b[1] - a[1]);
    const hottestTopics = Object.entries(topicMap).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name]) => name);

    setDistributionData(sortedSubjects.map(([name, value]) => ({ name, value })));
    setHeatmapData(yearSubjectMap);
    setTopTopics(hottestTopics);
    setTrendSubjects(sortedSubjects.slice(0, 4).map(([name]) => name));

    const filteredTopicHeatmap: Record<string, Record<string, number>> = {};
    hottestTopics.forEach(topic => {
      filteredTopicHeatmap[topic] = topicYearMap[topic] || {};
    });
    setTopicYearHeatmap(filteredTopicHeatmap);
  };

  useEffect(() => {
    if (!selectedSubject) {
      setSectionData([]);
      setSelectedSection(null);
      return;
    }
    const sectionMap: Record<string, number> = {};
    rawQuestions
      .filter(q => getAnalyticsSubject(q) === selectedSubject)
      .forEach(q => {
        const section = q.section_group || 'General';
        sectionMap[section] = (sectionMap[section] || 0) + 1;
      });
    setSectionData(Object.entries(sectionMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value));
  }, [selectedSubject, rawQuestions]);

  useEffect(() => {
    if (!selectedSubject || !selectedSection) {
      setMicroTopicData([]);
      return;
    }
    const microMap: Record<string, number> = {};
    rawQuestions
      .filter(q => getAnalyticsSubject(q) === selectedSubject && (q.section_group || 'General') === selectedSection)
      .forEach(q => {
        const micro = q.micro_topic || 'Other';
        microMap[micro] = (microMap[micro] || 0) + 1;
      });
    setMicroTopicData(Object.entries(microMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value));
  }, [selectedSubject, selectedSection, rawQuestions]);

  const years = useMemo(() => {
    const questionYears = rawQuestions
      .map(getAnalyticsYear)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const testYears = Object.values(testsMetaById)
      .map((test: any) => getTestYear(test))
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    return Array.from(new Set([...questionYears, ...testYears]))
      .sort((a, b) => b - a)
      .map(String);
  }, [rawQuestions, testsMetaById]);

  const heatmapSections = useMemo(() => {
    if (heatmapSubject === 'All') return [];
    const map: Record<string, Record<string, number>> = {};
    rawQuestions
      .filter(q => getAnalyticsSubject(q) === heatmapSubject)
      .forEach(q => {
        const section = q.section_group || 'General';
        const year = String(getAnalyticsYear(q) || '');
        if (!year) return;
        if (!map[section]) map[section] = {};
        map[section][year] = (map[section][year] || 0) + 1;
      });
    return Object.entries(map)
      .map(([name, byYear]) => ({ name, byYear, total: Object.values(byYear).reduce((sum, val) => sum + val, 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 14);
  }, [rawQuestions, heatmapSubject, years]);

  const heatmapMicros = useMemo(() => {
    if (heatmapSubject === 'All') return [];
    const map: Record<string, Record<string, number>> = {};
    rawQuestions
      .filter(q => getAnalyticsSubject(q) === heatmapSubject)
      .forEach(q => {
        const micro = q.micro_topic || 'Other';
        const year = String(getAnalyticsYear(q) || '');
        if (!year) return;
        if (!map[micro]) map[micro] = {};
        map[micro][year] = (map[micro][year] || 0) + 1;
      });
    return Object.entries(map)
      .map(([name, byYear]) => ({ name, byYear, total: Object.values(byYear).reduce((sum, val) => sum + val, 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);
  }, [rawQuestions, heatmapSubject, years]);

  const subjectHeatmapRows = useMemo<HeatmapRow[]>(() => {
    return distributionData.slice(0, 16).map(item => ({
      key: `subject-${item.name}`,
      label: item.name,
      byYear: years.reduce((acc, year) => {
        const count = heatmapData[year]?.[item.name] || 0;
        if (count) acc[year] = count;
        return acc;
      }, {} as Record<string, number>),
    }));
  }, [distributionData, years, heatmapData]);

  const topicHeatmapRows = useMemo<HeatmapRow[]>(() => {
    return topTopics.map(topic => ({
      key: `topic-${topic}`,
      label: topic,
      byYear: topicYearHeatmap[topic] || {},
    }));
  }, [topTopics, topicYearHeatmap]);

  const sectionHeatmapRows = useMemo<HeatmapRow[]>(() => {
    return heatmapSections.map(item => ({
      key: `section-${item.name}`,
      label: item.name,
      byYear: item.byYear,
    }));
  }, [heatmapSections]);

  const microHeatmapRows = useMemo<HeatmapRow[]>(() => {
    return heatmapMicros.map(item => ({
      key: `micro-${item.name}`,
      label: item.name,
      byYear: item.byYear,
    }));
  }, [heatmapMicros]);

  const trendColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    distributionData.forEach((item, index) => {
      map[item.name] = TREND_PALETTE[index % TREND_PALETTE.length];
    });
    return map;
  }, [distributionData]);

  const topThreeSubjects = useMemo(() => distributionData.slice(0, 3), [distributionData]);
  const exportSubjects = useMemo(() => distributionData.map(item => item.name), [distributionData]);
  const focusSubjects = useMemo(() => ['All', ...Array.from(new Set(rawQuestions.map(q => getAnalyticsSubject(q))))], [rawQuestions]);
  const focusSections = useMemo(() => {
    if (focusSubject === 'All') return ['All'];
    return ['All', ...Array.from(new Set(rawQuestions.filter(q => getAnalyticsSubject(q) === focusSubject).map(q => q.section_group || 'General')))];
  }, [rawQuestions, focusSubject]);
  const focusMicros = useMemo(() => {
    return [
      'All',
      ...Array.from(
        new Set(
          rawQuestions
            .filter(q => (focusSubject === 'All' || getAnalyticsSubject(q) === focusSubject) && (focusSection === 'All' || (q.section_group || 'General') === focusSection))
            .map(q => q.micro_topic || 'Other')
        )
      ),
    ];
  }, [rawQuestions, focusSubject, focusSection]);

  const breakdownData = useMemo(() => {
    if (!selectedSubject) return distributionData;
    if (!selectedSection) return sectionData;
    return microTopicData;
  }, [distributionData, sectionData, microTopicData, selectedSubject, selectedSection]);

  const donutData = useMemo(() => {
    const source = breakdownData.slice(0, 5);
    const rest = breakdownData.slice(5).reduce((sum, item) => sum + item.value, 0);
    const compact = source.map(item => ({ tag: item.name, count: item.value }));
    if (rest > 0) compact.push({ tag: 'Others', count: rest });
    return compact;
  }, [breakdownData]);

  const overviewSeries = useMemo(() => {
    return trendSubjects.map(subject => ({
      label: subject,
      values: years.map(year => heatmapData[year]?.[subject] || 0),
    }));
  }, [trendSubjects, years, heatmapData]);


  const focusTrendSeries = useMemo(() => {
    const label =
      focusMicro !== 'All'
        ? focusMicro
        : focusSection !== 'All'
          ? `${focusSubject} / ${focusSection}`
          : focusSubject !== 'All'
            ? focusSubject
            : 'All PYQ';
    return [
      {
        label,
        values: years.map(year => {
          const numYear = Number(year);
          return rawQuestions.filter(q => {
            if (getAnalyticsYear(q) !== numYear) return false;
            if (focusSubject !== 'All' && getAnalyticsSubject(q) !== focusSubject) return false;
            if (focusSection !== 'All' && (q.section_group || 'General') !== focusSection) return false;
            if (focusMicro !== 'All' && (q.micro_topic || 'Other') !== focusMicro) return false;
            return true;
          }).length;
        }),
      },
    ];
  }, [rawQuestions, years, focusSubject, focusSection, focusMicro]);

  useEffect(() => {
    if (exportSubjects.length === 0) {
      setExportSubject('');
      return;
    }
    if (!exportSubject || !exportSubjects.includes(exportSubject)) {
      setExportSubject(exportSubjects[0]);
    }
  }, [exportSubjects, exportSubject]);

  const openModal = (type: 'stage' | 'paper' | 'range') => {
    setModalType(type);
    setModalVisible(true);
  };

  const handleSelect = (value: string) => {
    if (modalType === 'stage') {
      setExamStage(value);
      setSelectedPaper(PAPERS[value as keyof typeof PAPERS][0]);
    } else if (modalType === 'paper') {
      setSelectedPaper(value);
    } else if (modalType === 'range') {
      setSelectedRange(value);
    }
    setModalVisible(false);
  };

  const navigateToLearning = (opts: { subject?: string; section?: string; micro?: string; year?: string }) => {
    router.push({
      pathname: '/unified/engine',
      params: {
        mode: 'learning',
        view: 'list',
        institutes: 'UPSC',
        pyqFilter: 'PYQ Only',
        subject: opts.subject || 'All',
        section: opts.section || '',
        microTopics: opts.micro || '',
        specificYear: opts.year || '',
      },
    });
  };

  const exportPdf = async (mode: ExportMode, subjectOverride?: string) => {
    if (!rawQuestions.length) {
      Alert.alert('No data to export', 'Please load PYQ data before exporting a PDF.');
      return;
    }

    console.log(`[PDFExport] Starting export in mode: ${mode}, subject: ${subjectOverride || 'N/A'}`);
    setExporting(true);
    // Add a small delay to allow the modal to close completely before heavy processing
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const esc = (value: string | number) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const hslToHex = (h: number, s: number, l: number) => {
      l /= 100;
      const a = (s * Math.min(l, 1 - l)) / 100;
      const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    };

    const hexToRgb = (hex: string) => {
      const clean = String(hex || '').replace('#', '');
      if (clean.length !== 6) return '37,99,235';
      const r = parseInt(clean.slice(0, 2), 16);
      const g = parseInt(clean.slice(2, 4), 16);
      const b = parseInt(clean.slice(4, 6), 16);
      if ([r, g, b].some(Number.isNaN)) return '37,99,235';
      return `${r},${g},${b}`;
    };

    const renderBarChart = (title: string, rows: Array<{ name: string; value: number }>, color = '#2563eb') => {
      if (!rows.length) return '';
      const max = Math.max(...rows.map(row => row.value), 1);
      return `
        <h2>${esc(title)}</h2>
        <div class="bar-card">
          ${rows.map(row => `
            <div class="bar-row">
              <div class="bar-label">${esc(row.name)}</div>
              <div class="bar-track"><div class="bar-fill" style="background:${color}; width:${Math.max((row.value / max) * 100, 3)}%"></div></div>
              <div class="bar-value">${row.value}</div>
            </div>
          `).join('')}
        </div>
      `;
    };

    const renderTable = (title: string, headers: string[], rows: Array<Array<string | number>>) => {
      if (!rows.length) return '';
      return `
        <h2>${esc(title)}</h2>
        <table>
          <tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr>
          ${rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}
        </table>
      `;
    };

    const renderLineChart = (
      title: string,
      labels: string[],
      series: Array<{ label: string; values: number[] }>,
      palette: string[]
    ) => {
      if (!labels.length || !series.length) return '';
      const widthSvg = 980;
      const heightSvg = 320;
      const leftPad = 56;
      const rightPad = 24;
      const topPad = 26;
      const bottomPad = 56;
      const plotW = widthSvg - leftPad - rightPad;
      const plotH = heightSvg - topPad - bottomPad;
      const maxValue = Math.max(...series.flatMap(item => item.values), 1);
      const x = (index: number) => leftPad + (labels.length === 1 ? 0 : (index * plotW) / (labels.length - 1));
      const y = (value: number) => topPad + plotH - (value / maxValue) * plotH;

      const gridLines = [0, 0.25, 0.5, 0.75, 1].map(step => {
        const yy = topPad + plotH - step * plotH;
        const val = Math.round(maxValue * step);
        return `<line x1="${leftPad}" y1="${yy}" x2="${widthSvg - rightPad}" y2="${yy}" stroke="#e2e8f0" stroke-width="1" />
                <text x="${leftPad - 8}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#64748b">${val}</text>`;
      }).join('');

      const seriesSvg = series.map((item, idx) => {
        const color = palette[idx % palette.length] || '#2563eb';
        const points = item.values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
        const dots = item.values.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="3" fill="${color}" />`).join('');
        return `<polyline fill="none" stroke="${color}" stroke-width="3" points="${points}"/>${dots}`;
      }).join('');

      const xLabels = labels.map((label, index) => `<text x="${x(index)}" y="${heightSvg - 18}" text-anchor="middle" font-size="10" fill="#475569">${esc(label)}</text>`).join('');
      const legend = series.map((item, idx) => {
        const color = palette[idx % palette.length] || '#2563eb';
        return `<span class="legend-item"><span class="legend-dot" style="background:${color}"></span>${esc(item.label)}</span>`;
      }).join('');

      return `
        <h2>${esc(title)}</h2>
        <div class="legend-wrap">${legend}</div>
        <div class="chart-card">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthSvg} ${heightSvg}" width="100%" height="${heightSvg}">
            <rect x="${leftPad}" y="${topPad}" width="${plotW}" height="${plotH}" fill="#ffffff" stroke="#e2e8f0" stroke-width="1" />
            ${gridLines}
            ${seriesSvg}
            ${xLabels}
          </svg>
        </div>
      `;
    };

    const renderDonut = (title: string, rows: Array<{ name: string; value: number }>) => {
      if (!rows.length) return '';
      const topRows = rows.slice(0, 8);
      const rest = rows.slice(8).reduce((sum, item) => sum + item.value, 0);
      const compact = [...topRows];
      if (rest > 0) compact.push({ name: 'Others', value: rest });
      const total = Math.max(compact.reduce((sum, item) => sum + item.value, 0), 1);
      const radius = 66;
      const circumference = 2 * Math.PI * radius;
      let cumulative = 0;
      const segments = compact.map((item, index) => {
        const color = TREND_PALETTE[index % TREND_PALETTE.length];
        const len = (item.value / total) * circumference;
        const segment = `<circle cx="90" cy="90" r="${radius}" fill="none" stroke="${color}" stroke-width="34" stroke-dasharray="${len} ${circumference}" stroke-dashoffset="${-cumulative}" transform="rotate(-90 90 90)"/>`;
        cumulative += len;
        return segment;
      }).join('');

      const legend = compact.map((item, index) => {
        const color = TREND_PALETTE[index % TREND_PALETTE.length];
        return `<div class="donut-legend-row"><span class="donut-legend-dot" style="background:${color}"></span><span>${esc(item.name)}</span><strong>${item.value}</strong></div>`;
      }).join('');

      return `
        <h2>${esc(title)}</h2>
        <div class="donut-wrap">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="200" height="200">
            <circle cx="90" cy="90" r="${radius}" fill="none" stroke="#e2e8f0" stroke-width="34"/>
            ${segments}
            <text x="90" y="86" text-anchor="middle" font-size="18" font-weight="700" fill="#0f172a">${total}</text>
            <text x="90" y="104" text-anchor="middle" font-size="10" fill="#64748b">QUESTIONS</text>
          </svg>
          <div class="donut-legend">
            ${legend}
          </div>
        </div>
      `;
    };

    const renderHeatmap = (
      title: string,
      labelHeader: string,
      rows: HeatmapRow[],
      baseColorHex: string,
      divisor: number
    ) => {
      if (!rows.length) return '';
      const rgb = hexToRgb(baseColorHex);
      return `
        <h2>${esc(title)}</h2>
        <table>
          <tr><th>${esc(labelHeader)}</th>${years.map(year => `<th>${esc(year)}</th>`).join('')}</tr>
          ${rows.map(row => `
            <tr>
              <td>${esc(row.label)}</td>
              ${years.map(year => {
                const count = row.byYear[year] || 0;
                let bg = '#f8fafc';
                let tc = '#94a3b8';
                
                if (count > 0) {
                  const capped = Math.min(count, 22);
                  const ratio = (capped - 1) / 21;
                  if (heatmapPalette === 'spectral') {
                    const h = 70 + (ratio * 155);
                    const s = 65 + (ratio * 20);
                    const l = 85 - (ratio * 55);
                    bg = hslToHex(h, s, l);
                    tc = l < 55 ? '#ffffff' : '#065f46';
                  } else {
                    const h = 210 + (ratio * 15);
                    const s = 60 + (ratio * 35);
                    const l = 90 - (ratio * 65);
                    bg = hslToHex(h, s, l);
                    tc = l < 55 ? '#ffffff' : '#1e3a8a';
                  }
                }
                return `<td style="padding: 1px; border: none; width: 44px; height: 32px;">
                  <svg width="44" height="32" viewBox="0 0 44 32" xmlns="http://www.w3.org/2000/svg">
                    <rect width="44" height="32" rx="5" fill="${bg}" />
                    <text x="22" y="20.5" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="800" fill="${tc}">${count || ''}</text>
                  </svg>
                </td>`;
              }).join('')}
            </tr>
          `).join('')}
        </table>
      `;
    };

    const buildSubjectDeepDive = (subject: string) => {
      const qns = rawQuestions.filter(q => getAnalyticsSubject(q) === subject);
      const sectionMap: Record<string, number> = {};
      const microMap: Record<string, number> = {};
      const sectionYearMap: Record<string, Record<string, number>> = {};
      const microYearMap: Record<string, Record<string, number>> = {};

      qns.forEach(q => {
        const year = String(getAnalyticsYear(q) || '');
        if (!year) return;
        const section = q.section_group || 'General';
        const micro = q.micro_topic || 'Other';

        sectionMap[section] = (sectionMap[section] || 0) + 1;
        microMap[micro] = (microMap[micro] || 0) + 1;

        if (!sectionYearMap[section]) sectionYearMap[section] = {};
        sectionYearMap[section][year] = (sectionYearMap[section][year] || 0) + 1;

        if (!microYearMap[micro]) microYearMap[micro] = {};
        microYearMap[micro][year] = (microYearMap[micro][year] || 0) + 1;
      });

      const sectionRows = Object.entries(sectionMap)
        .map(([name, value]) => ({ name, value, byYear: sectionYearMap[name] || {} }))
        .sort((a, b) => b.value - a.value);
      const microRows = Object.entries(microMap)
        .map(([name, value]) => ({ name, value, byYear: microYearMap[name] || {} }))
        .sort((a, b) => b.value - a.value);

      const subjectSeries = [{ label: subject, values: years.map(year => heatmapData[year]?.[subject] || 0) }];

      return `
        <div class="page-break"></div>
        <h2>${esc(subject)} — Deep Dive</h2>
        ${renderLineChart(`${subject} Momentum`, years, subjectSeries, ['#2563eb'])}
        ${renderBarChart(`${subject} Section Distribution`, sectionRows.slice(0, 14).map(item => ({ name: item.name, value: item.value })), '#2563eb')}
        ${renderTable(`${subject} Section Distribution Table`, ['Section', 'Questions'], sectionRows.slice(0, 20).map(item => [item.name, item.value]))}
        ${renderBarChart(`${subject} Micro Topic Distribution`, microRows.slice(0, 20).map(item => ({ name: item.name, value: item.value })), '#1d4ed8')}
        ${renderTable(`${subject} Micro Topic Distribution Table`, ['Micro Topic', 'Questions'], microRows.slice(0, 24).map(item => [item.name, item.value]))}
        ${renderHeatmap(`${subject} Section Group x Year Heatmap`, 'Section', sectionRows.slice(0, 14).map(item => ({ key: `sec-${item.name}`, label: item.name, byYear: item.byYear })), '#2563eb', 8)}
        ${renderHeatmap(`${subject} Micro Topic x Year Heatmap`, 'Micro Topic', microRows.slice(0, 20).map(item => ({ key: `micro-${item.name}`, label: item.name, byYear: item.byYear })), '#1d4ed8', 8)}
      `;
    };

    const focusedLabel = focusMicro !== 'All' ? focusMicro : focusSection !== 'All' ? `${focusSubject} / ${focusSection}` : focusSubject;
    const subjectCountRows = distributionData.map(item => [item.name, item.value]);

    const blocks: string[] = [];
    const includeAll = mode === 'all';

    if (includeAll || mode === 'momentum') {
      blocks.push(renderLineChart('Subject Momentum', years, overviewSeries, overviewSeries.map(item => trendColorMap[item.label] || '#2563eb')));
    }

    if (includeAll || mode === 'distribution') {
      blocks.push(renderDonut('Subject Distribution (Donut)', distributionData));
      blocks.push(renderBarChart('Subject Distribution (Bar)', distributionData.slice(0, 20)));
      blocks.push(renderTable('Subject Distribution Table', ['Subject', 'Questions'], subjectCountRows));
    }

    if (includeAll || mode === 'focused') {
      blocks.push(renderLineChart('Focused Trend', years, focusTrendSeries, ['#2563eb']));
      blocks.push(renderTable('Focused Trend Table', ['Year', focusedLabel || 'Count'], years.map((year, idx) => [year, focusTrendSeries[0]?.values[idx] || 0])));
    }

    if (includeAll || mode === 'heatmaps') {
      blocks.push(renderHeatmap('Subject x Year Heatmap', 'Subject', subjectHeatmapRows, '#2563eb', 14));
      blocks.push(renderHeatmap('Top 20 Topics x Year Heatmap', 'Topic', topicHeatmapRows, '#1d4ed8', 10));
    }

    if (mode === 'subject_one') {
      const subject = subjectOverride || exportSubject || exportSubjects[0];
      if (subject) blocks.push(buildSubjectDeepDive(subject));
    }

    if (mode === 'subject_all') {
      // First Page: Combined Overview for All Subjects
      blocks.push(renderLineChart('All Subjects Momentum', years, overviewSeries, overviewSeries.map(item => trendColorMap[item.label] || '#2563eb')));
      blocks.push(renderDonut('All Subjects Distribution', distributionData));
      blocks.push(renderHeatmap('All Subjects x Year Heatmap', 'Subject', subjectHeatmapRows, '#2563eb', 14));
      blocks.push(renderTable('All Subjects Distribution Table', ['Subject', 'Questions'], distributionData.map(item => [item.name, item.value])));

      // Subsequent Pages: Deep Dive for each Subject
      exportSubjects.forEach(subject => {
        blocks.push(buildSubjectDeepDive(subject));
      });
    }

    const html = `
      <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; padding: 22px; color: #0f172a; }
          h1 { margin: 0 0 8px; font-size: 24px; }
          h2 { margin: 20px 0 10px; font-size: 17px; color: #1e293b; }
          .meta { margin: 0 0 12px; color: #475569; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; table-layout: auto; }
          td, th { border: 1px solid #d1d5db; padding: 6px; font-size: 11px; vertical-align: middle; }
          th { background: #f8fafc; text-align: left; }
          td:first-child, th:first-child { width: 200px; min-width: 200px; }
          .chart-card { border: 1px solid #d1d5db; border-radius: 12px; padding: 10px; margin-bottom: 16px; background: #fff; }
          .bar-card { border: 1px solid #d1d5db; border-radius: 12px; padding: 12px; margin-bottom: 16px; }
          .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
          .bar-label { width: 210px; font-size: 11px; color: #334155; }
          .bar-track { flex: 1; background: #e2e8f0; height: 10px; border-radius: 999px; overflow: hidden; }
          .bar-fill { height: 100%; border-radius: 999px; }
          .bar-value { width: 44px; text-align: right; font-size: 11px; font-weight: 700; }
          .legend-wrap { margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 8px; }
          .legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #334155; }
          .legend-dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
          .donut-wrap { border: 1px solid #d1d5db; border-radius: 12px; display: flex; gap: 18px; padding: 12px; align-items: center; margin-bottom: 16px; }
          .donut-legend { flex: 1; }
          .donut-legend-row { display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 4px 0; }
          .donut-legend-dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; margin-right: 7px; }
          .page-break { page-break-before: always; }
          
          /* Prevent cutting and force background colors */
          table, tr, .chart-card, .bar-card, .donut-wrap { 
            page-break-inside: avoid; 
            -webkit-print-color-adjust: exact; 
            print-color-adjust: exact; 
          }
          td, th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          thead { display: table-header-group; }
          tr { page-break-after: auto; }
        </style>
      </head>
      <body>
        <h1>${esc(`${examStage} ${selectedPaper} PYQ Analysis`)}</h1>
        <div class="meta">Range: ${esc(selectedRange)}${selectedRange === 'Custom Range' ? ` (${esc(customYearStart)} - ${esc(customYearEnd)})` : ''}</div>
        <div class="meta">Questions fetched: ${rawQuestions.length} | Subjects: ${distributionData.length} | Years: ${years.join(', ')}</div>
        ${blocks.join('')}
      </body>
      </html>
    `;

    console.log(`[PDFExport] HTML generated. Length: ${html.length}`);

      const canShare = await Sharing.isAvailableAsync();
      console.log(`[PDFExport] Sharing available: ${canShare}`);
      if (canShare && Platform.OS !== 'web') {
        console.log(`[PDFExport] Printing to file...`);
        const { uri } = await Print.printToFileAsync({ html });
        console.log(`[PDFExport] File printed to: ${uri}. Opening share menu...`);
        setExporting(false); 
        
        // Small delay to ensure the overlay is fully gone from the UI hierarchy
        await new Promise(resolve => setTimeout(resolve, 300));

        try {
          await Sharing.shareAsync(uri, { 
            mimeType: 'application/pdf', 
            dialogTitle: 'PYQ Analysis Report',
            UTI: 'com.adobe.pdf' 
          });
        } catch (shareErr) {
          console.error('[PDFExport] Sharing failed, falling back to Print dialog', shareErr);
          await Print.printAsync({ html });
        }
      } else {
        console.log(`[PDFExport] Printing directly...`);
        await Print.printAsync({ html });
      }
    } catch (error: any) {
      console.error('PDF export failed', error);
      Alert.alert('Export failed', error?.message || 'Unable to export PDF right now.');
    } finally {
      setExporting(false);
    }
  };

  const renderHeader = () => (
    <View style={[styles.header, { 
      borderBottomColor: colors.border, 
      backgroundColor: colors.bg,
      paddingTop: isEmbedded ? 12 : Math.max(insets.top, 16)
    }]}>
      {!isEmbedded ? (
        <TouchableOpacity onPress={() => router.back()} style={styles.headerIcon}>
          <ChevronLeft color={colors.textPrimary} size={22} />
        </TouchableOpacity>
      ) : <View style={styles.headerIcon} />}
      <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>PYQ Analysis</Text>
      <TouchableOpacity onPress={() => setExportModalVisible(true)} style={[styles.headerIcon, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Download color={colors.primary} size={18} />
      </TouchableOpacity>
    </View>
  );

  const renderOverview = () => (
    <View style={styles.blockGap}>
      <View style={styles.topCardRow}>
        {topThreeSubjects.map((item, idx) => (
          <View key={item.name} style={[styles.topCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.topRank, { color: colors.primary }]}>Top {idx + 1}</Text>
            <Text style={[styles.topName, { color: colors.textPrimary }]} numberOfLines={2}>{item.name}</Text>
            <Text style={[styles.topCount, { color: colors.textSecondary }]}>{item.value} questions</Text>
          </View>
        ))}
      </View>

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>Subject Momentum</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {distributionData.map(item => {
            const active = trendSubjects.includes(item.name);
            const seriesColor = trendColorMap[item.name] || colors.primary;
            return (
              <TouchableOpacity
                key={item.name}
                style={[
                  styles.seriesChip,
                  { borderColor: active ? seriesColor : colors.border, backgroundColor: active ? seriesColor : colors.surfaceStrong },
                ]}
                onPress={() => {
                  setTrendSubjects(prev => {
                    if (prev.includes(item.name)) return prev.filter(v => v !== item.name);
                    if (prev.length >= 6) return [...prev.slice(1), item.name];
                    return [...prev, item.name];
                  });
                }}
              >
                <View style={[styles.seriesDot, { backgroundColor: active ? '#ffffff' : seriesColor }]} />
                <Text style={[styles.seriesChipText, { color: active ? '#ffffff' : colors.textSecondary }]}>{item.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {overviewSeries.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <LineChart
              labels={years}
              data={overviewSeries}
              colors={overviewSeries.map(series => trendColorMap[series.label] || colors.primary)}
              height={300}
              width={Math.max(width * 1.45, years.length * 96, 420)}
              topInset={30}
            />
          </ScrollView>
        ) : (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Select subjects to compare their year-wise momentum.</Text>
        )}
      </View>

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>Subject Distribution</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pieScroll}>
          <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={styles.pieVerticalScroll}>
            <PieChart
              data={donutData}
              size={258}
              canvasWidth={640}
              canvasHeight={390}
              centerLabel={String(donutData.reduce((sum, item) => sum + item.count, 0))}
              centerSubLabel="QUESTIONS"
              colors={donutData.map((_, index) => TREND_PALETTE[index % TREND_PALETTE.length])}
              onPress={tag => {
                if (tag === 'Others') return;
                if (!selectedSubject) {
                  setSelectedSubject(tag);
                } else if (!selectedSection) {
                  setSelectedSection(tag);
                }
              }}
            />
          </ScrollView>
        </ScrollView>
        <Text style={[styles.helperText, { color: colors.textSecondary, marginTop: 8 }]}>
          Click on the chart to deep dive from subject to section group to micro topic.
        </Text>
        <View style={[styles.tableWrap, { borderColor: colors.border }]}>
          {breakdownData.slice(0, 12).map((item, index) => (
            <TouchableOpacity
              key={`${item.name}-${index}`}
              style={[styles.tableRow, { borderBottomColor: colors.border + '60' }]}
              onPress={() => {
                if (!selectedSubject) {
                  setSelectedSubject(item.name);
                  return;
                }
                if (!selectedSection) {
                  setSelectedSection(item.name);
                  return;
                }
                navigateToLearning({
                  subject: selectedSubject || undefined,
                  section: selectedSection || undefined,
                  micro: item.name,
                });
              }}
            >
              <Text style={[styles.tableName, { color: colors.textPrimary }]} numberOfLines={1}>{item.name}</Text>
              <Text style={[styles.tableValue, { color: colors.textSecondary }]}>{item.value}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {(selectedSubject || selectedSection) ? (
          <TouchableOpacity
            style={[styles.backBtn, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }]}
            onPress={() => {
              if (selectedSection) setSelectedSection(null);
              else setSelectedSubject(null);
            }}
          >
            <Text style={[styles.backBtnText, { color: colors.textSecondary }]}>Go one level up</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  const renderSubjectYearHeatmap = () => (
    <View style={styles.blockGap}>
      <View style={styles.paletteRow}>
        <Text style={[styles.paletteLabel, { color: colors.textTertiary }]}>HEATMAP THEME:</Text>
        <TouchableOpacity 
          style={[styles.paletteChip, heatmapPalette === 'spectral' && { backgroundColor: colors.primary, borderColor: colors.primary }]} 
          onPress={() => setHeatmapPalette('spectral')}
        >
          <Text style={[styles.paletteChipText, { color: heatmapPalette === 'spectral' ? '#fff' : colors.textSecondary }]}>Spectral</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.paletteChip, heatmapPalette === 'ocean' && { backgroundColor: colors.primary, borderColor: colors.primary }]} 
          onPress={() => setHeatmapPalette('ocean')}
        >
          <Text style={[styles.paletteChipText, { color: heatmapPalette === 'ocean' ? '#fff' : colors.textSecondary }]}>Ocean Blue</Text>
        </TouchableOpacity>
      </View>
      <StickyHeatmapTable
        title="Subject x Year Heatmap"
        labelHeader="Subject"
        years={years}
        rows={subjectHeatmapRows}
        baseColor="#2563eb"
        maxOpacityDivisor={14}
        colors={colors}
        heatmapPalette={heatmapPalette}
        onCellPress={(subject, year) => navigateToLearning({ subject, year })}
      />
    </View>
  );

  const renderTopicYearHeatmap = () => (
    <StickyHeatmapTable
      title="Top 20 Topics x Year"
      labelHeader="Topic"
      years={years}
      rows={topicHeatmapRows}
      baseColor="#1d4ed8"
      maxOpacityDivisor={10}
      colors={colors}
      heatmapPalette={heatmapPalette}
      onCellPress={(topic, year) => navigateToLearning({ micro: topic, year })}
    />
  );

  const renderSubjectDeepHeatmaps = () => (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>Subject Distribution</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {['All', ...distributionData.map(item => item.name)].map(item => (
          <TouchableOpacity
            key={`heat-subject-${item}`}
            style={[
              styles.filterChip,
              { borderColor: colors.border, backgroundColor: colors.surfaceStrong },
              heatmapSubject === item && { backgroundColor: colors.primary, borderColor: colors.primaryDark }
            ]}
            onPress={() => setHeatmapSubject(item)}
          >
            <Text style={[styles.filterChipText, { color: heatmapSubject === item ? colors.buttonText : colors.textSecondary }]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {heatmapSubject === 'All' ? (
        <Text style={[styles.helperText, { color: colors.textSecondary }]}>Choose a subject to open section-group and micro-topic heatmaps for that subject.</Text>
      ) : (
        <>
          <StickyHeatmapTable
            title="Section Group x Year"
            labelHeader="Section"
            years={years}
            rows={sectionHeatmapRows}
            baseColor="#2563eb"
            maxOpacityDivisor={8}
            colors={colors}
            heatmapPalette={heatmapPalette}
            onCellPress={(section, year) => navigateToLearning({ subject: heatmapSubject, section, year })}
          />

          <StickyHeatmapTable
            title="Micro Topic x Year"
            labelHeader="Micro Topic"
            years={years}
            rows={microHeatmapRows}
            baseColor="#1d4ed8"
            maxOpacityDivisor={8}
            colors={colors}
            heatmapPalette={heatmapPalette}
            onCellPress={(micro, year) => navigateToLearning({ subject: heatmapSubject, micro, year })}
          />
        </>
      )}
    </View>
  );

  const renderFocusedTrend = () => (
    <View style={styles.blockGap}>
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>Focused Trend</Text>
        <Text style={[styles.helperText, { color: colors.textSecondary }]}>
          Subject only, then deeper into section group and micro topic when you need it.
        </Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {focusSubjects.map(item => (
            <TouchableOpacity
              key={`subject-${item}`}
              style={[styles.filterChip, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }, focusSubject === item && { backgroundColor: colors.primary, borderColor: colors.primaryDark }]}
              onPress={() => {
                setFocusSubject(item);
                setFocusSection('All');
                setFocusMicro('All');
              }}
            >
              <Text style={[styles.filterChipText, { color: focusSubject === item ? colors.buttonText : colors.textSecondary }]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {focusSubject !== 'All' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {focusSections.map(item => (
              <TouchableOpacity
                key={`section-${item}`}
                style={[styles.filterChip, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }, focusSection === item && { backgroundColor: colors.primary, borderColor: colors.primaryDark }]}
                onPress={() => {
                  setFocusSection(item);
                  setFocusMicro('All');
                }}
              >
                <Text style={[styles.filterChipText, { color: focusSection === item ? colors.buttonText : colors.textSecondary }]}>{item}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {focusSection !== 'All' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {focusMicros.map(item => (
              <TouchableOpacity
                key={`micro-${item}`}
                style={[styles.filterChip, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }, focusMicro === item && { backgroundColor: colors.primary, borderColor: colors.primaryDark }]}
                onPress={() => setFocusMicro(item)}
              >
                <Text style={[styles.filterChipText, { color: focusMicro === item ? colors.buttonText : colors.textSecondary }]}>{item}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <LineChart
            labels={years}
            data={focusTrendSeries}
            colors={[colors.primary]}
            height={320}
            width={Math.max(width * 1.65, years.length * 108, 460)}
            topInset={34}
          />
        </ScrollView>

        <TouchableOpacity
          style={[styles.openBtn, { backgroundColor: colors.primary }]}
          onPress={() => navigateToLearning({
            subject: focusSubject === 'All' ? undefined : focusSubject,
            section: focusSection === 'All' ? undefined : focusSection,
            micro: focusMicro === 'All' ? undefined : focusMicro,
          })}
        >
          <Text style={[styles.openBtnText, { color: colors.buttonText }]}>Open This In Learn Mode</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: isEmbedded ? 'transparent' : colors.bg }]}>
      {renderHeader()}

      <View style={[styles.filterWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {[
          { label: 'Stage', value: examStage, type: 'stage' as const },
          { label: 'Paper', value: selectedPaper, type: 'paper' as const },
          { label: 'Years', value: selectedRange, type: 'range' as const },
        ].map(item => (
          <TouchableOpacity key={item.label} style={[styles.selector, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }]} onPress={() => openModal(item.type)}>
            <Text style={[styles.selectorLabel, { color: colors.textTertiary }]}>{item.label}</Text>
            <View style={styles.selectorValue}>
              <Text style={[styles.selectorText, { color: colors.textPrimary }]} numberOfLines={1}>{item.value}</Text>
              <ChevronDown size={14} color={colors.textTertiary} />
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {selectedRange === 'Custom Range' ? (
        <View style={[styles.rangeBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.rangeInputWrap}>
            <Text style={[styles.rangeLabel, { color: colors.textTertiary }]}>From</Text>
            <TextInput value={customYearStart} onChangeText={setCustomYearStart} keyboardType="number-pad" maxLength={4} style={[styles.yearInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surfaceStrong }]} />
          </View>
          <View style={styles.rangeInputWrap}>
            <Text style={[styles.rangeLabel, { color: colors.textTertiary }]}>To</Text>
            <TextInput value={customYearEnd} onChangeText={setCustomYearEnd} keyboardType="number-pad" maxLength={4} style={[styles.yearInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surfaceStrong }]} />
          </View>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={[styles.loaderBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loaderText, { color: colors.textSecondary }]}>Loading PYQ analysis...</Text>
          </View>
        ) : (
          <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
            {rawQuestions.length === 0 ? (
              <View style={[styles.loaderBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.loaderText, { color: colors.textSecondary }]}>No PYQ matched this filter selection.</Text>
              </View>
            ) : (
              <>
                {activeHub === 'overview' && renderOverview()}
                {activeHub === 'heatmaps' && <View style={styles.blockGap}>{renderSubjectYearHeatmap()}{renderTopicYearHeatmap()}{renderSubjectDeepHeatmaps()}</View>}
                {activeHub === 'focused' && renderFocusedTrend()}
              </>
            )}
          </Animated.View>
        )}
      </ScrollView>

      {exporting && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }]}>
          <View style={{ backgroundColor: colors.surface, padding: 24, borderRadius: 20, alignItems: 'center', gap: 12 }}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ color: colors.textPrimary, fontWeight: '800' }}>Generating PDF Report...</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>This may take a few seconds</Text>
          </View>
        </View>
      )}

      <View style={[styles.tabBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {[
          { key: 'overview', label: 'Overview', icon: TrendingUp },
          { key: 'heatmaps', label: 'Heatmaps', icon: Grid },
          { key: 'focused', label: 'Focused', icon: LineIcon },
        ].map(item => {
          const Icon = item.icon;
          const active = activeHub === item.key;
          return (
            <TouchableOpacity key={item.key} style={styles.tabItem} onPress={() => setActiveHub(item.key as HubKey)}>
              <Icon size={18} color={active ? colors.primary : colors.textTertiary} />
              <Text style={[styles.tabLabel, { color: active ? colors.primary : colors.textTertiary }]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Modal visible={exportModalVisible} transparent animationType="slide" onRequestClose={() => setExportModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setExportModalVisible(false)}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}> 
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Export PYQ PDF</Text>
              <TouchableOpacity onPress={() => setExportModalVisible(false)}><X size={22} color={colors.textPrimary} /></TouchableOpacity>
            </View>

            <ScrollView>
              <Text style={[styles.exportGroupLabel, { color: colors.textTertiary }]}>QUICK EXPORTS</Text>
              <TouchableOpacity style={[styles.exportActionBtn, { backgroundColor: colors.primary }]} onPress={() => { setExportModalVisible(false); exportPdf('all'); }}>
                <Text style={[styles.exportActionText, { color: colors.buttonText }]}>Export Full Report (All Sections)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.exportActionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }]} onPress={() => { setExportModalVisible(false); exportPdf('momentum'); }}>
                <Text style={[styles.exportActionText, { color: colors.textPrimary }]}>Export Subject Momentum</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.exportActionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }]} onPress={() => { setExportModalVisible(false); exportPdf('distribution'); }}>
                <Text style={[styles.exportActionText, { color: colors.textPrimary }]}>Export Subject Distribution</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.exportActionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }]} onPress={() => { setExportModalVisible(false); exportPdf('heatmaps'); }}>
                <Text style={[styles.exportActionText, { color: colors.textPrimary }]}>Export Heatmaps</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.exportActionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }]} onPress={() => { setExportModalVisible(false); exportPdf('focused'); }}>
                <Text style={[styles.exportActionText, { color: colors.textPrimary }]}>Export Focused Trend</Text>
              </TouchableOpacity>

              <Text style={[styles.exportGroupLabel, { color: colors.textTertiary, marginTop: 14 }]}>SUBJECT-WISE EXPORTS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {exportSubjects.map(subject => (
                  <TouchableOpacity
                    key={`export-sub-${subject}`}
                    style={[
                      styles.filterChip,
                      { borderColor: colors.border, backgroundColor: colors.surfaceStrong },
                      exportSubject === subject && { backgroundColor: colors.primary, borderColor: colors.primaryDark },
                    ]}
                    onPress={() => setExportSubject(subject)}
                  >
                    <Text style={[styles.filterChipText, { color: exportSubject === subject ? colors.buttonText : colors.textSecondary }]}>{subject}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity
                style={[styles.exportActionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }]}
                onPress={() => {
                  setExportModalVisible(false);
                  if (exportSubject) exportPdf('subject_one', exportSubject);
                }}
              >
                <Text style={[styles.exportActionText, { color: colors.textPrimary }]}>Export Selected Subject Deep Dive</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.exportActionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }]}
                onPress={() => {
                  setExportModalVisible(false);
                  exportPdf('subject_all');
                }}
              >
                <Text style={[styles.exportActionText, { color: colors.textPrimary }]}>Export All Subjects Deep Dive</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Select {modalType}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}><X size={22} color={colors.textPrimary} /></TouchableOpacity>
            </View>
            <ScrollView>
              {(modalType === 'stage' ? EXAM_STAGES : modalType === 'paper' ? PAPERS[examStage as keyof typeof PAPERS] : RANGE_OPTIONS).map(item => (
                <TouchableOpacity key={item} style={[styles.modalItem, { borderBottomColor: colors.border }]} onPress={() => handleSelect(item)}>
                  <Text style={[styles.modalItemText, { color: colors.textPrimary }]}>{item}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: '900' },
  headerIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  filterWrap: { flexDirection: 'row', gap: 10, marginHorizontal: 12, marginTop: 12, padding: 12, borderRadius: 16, borderWidth: 1 },
  selector: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 10 },
  selectorLabel: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  selectorValue: { marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  selectorText: { fontSize: 12, fontWeight: '700', flex: 1 },
  rangeBox: { marginHorizontal: 12, marginTop: 10, borderRadius: 16, borderWidth: 1, padding: 12, flexDirection: 'row', gap: 12 },
  rangeInputWrap: { flex: 1 },
  rangeLabel: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginBottom: 6 },
  yearInput: { borderRadius: 10, borderWidth: 1, padding: 8, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  content: { paddingBottom: 100 },
  blockGap: { gap: 16, padding: 12 },
  topCardRow: { flexDirection: 'row', gap: 10 },
  topCard: { flex: 1, padding: 16, borderRadius: 20, borderWidth: 1 },
  topRank: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginBottom: 4 },
  topName: { fontSize: 14, fontWeight: '800', marginBottom: 4 },
  topCount: { fontSize: 11, fontWeight: '600' },
  panel: { padding: 16, borderRadius: 24, borderWidth: 1 },
  panelTitle: { fontSize: 16, fontWeight: '900', marginBottom: 16 },
  chipRow: { gap: 8, marginBottom: 12 },
  pieScroll: { paddingHorizontal: 8, minWidth: '100%' },
  pieVerticalScroll: { paddingBottom: 12, paddingRight: 12 },
  seriesChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderWidth: 1, gap: 8 },
  seriesDot: { width: 8, height: 8, borderRadius: 4 },
  seriesChipText: { fontSize: 12, fontWeight: '700' },
  emptyText: { textAlign: 'center', padding: 40, fontSize: 14, fontStyle: 'italic' },
  backBtn: { alignSelf: 'center', marginTop: 16, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  backBtnText: { fontSize: 12, fontWeight: '700' },
  heatmapFrame: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  heatmapStickyHeaderRow: { flexDirection: 'row' },
  heatmapStickyLabelHeader: {
    width: HEATMAP_LABEL_WIDTH,
    height: HEATMAP_ROW_HEIGHT,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRightWidth: 1,
  },
  heatmapLabelHeaderText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  heatmapYearHeaderTrack: { flexDirection: 'row' },
  heatmapYearHeaderCell: {
    width: HEATMAP_CELL_WIDTH,
    height: HEATMAP_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heatmapYearHeaderText: { fontSize: 10, fontWeight: '800' },
  heatmapBodyScroll: { maxHeight: HEATMAP_MAX_BODY_HEIGHT },
  heatmapBodyLayout: { flexDirection: 'row' },
  heatmapStickyLabelColumn: { width: HEATMAP_LABEL_WIDTH, borderRightWidth: 1 },
  heatmapStickyLabelCell: {
    width: HEATMAP_LABEL_WIDTH,
    height: HEATMAP_ROW_HEIGHT,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  heatmapStickyLabelText: { fontSize: 11, fontWeight: '700' },
  heatmapDataRow: { flexDirection: 'row', height: HEATMAP_ROW_HEIGHT },
  heatmapDataCell: {
    width: HEATMAP_CELL_WIDTH,
    height: HEATMAP_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heatCellText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  helperText: { fontSize: 12, marginBottom: 16, lineHeight: 18 },
  tableWrap: { marginTop: 12, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  tableName: { flex: 1, fontSize: 12, fontWeight: '700', paddingRight: 12 },
  tableValue: { fontSize: 12, fontWeight: '800' },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  filterChipText: { fontSize: 12, fontWeight: '700' },
  openBtn: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  openBtnText: { fontSize: 14, fontWeight: '800' },
  loaderBox: { height: 300, alignItems: 'center', justifyContent: 'center', margin: 12, borderRadius: 24, borderWidth: 1 },
  loaderText: { marginTop: 16, fontSize: 14, fontWeight: '600' },
  tabBar: { flexDirection: 'row', height: 70, borderTopWidth: 1, paddingBottom: 15 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  tabLabel: { fontSize: 11, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  modalItem: { paddingVertical: 18, borderBottomWidth: 1 },
  modalItemText: { fontSize: 16, fontWeight: '700' },
  exportGroupLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8, marginBottom: 8 },
  exportActionBtn: { minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginBottom: 10 },
  exportActionText: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
  paletteRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, marginTop: 4 },
  paletteLabel: { fontSize: 10, fontWeight: '800', marginRight: 4 },
  paletteChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  paletteChipText: { fontSize: 11, fontWeight: '700' },
});
