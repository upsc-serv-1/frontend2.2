import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  Animated,
  Dimensions,
  Platform,
  Keyboard,
} from 'react-native';
import { Search, Sliders, X, Clock, Zap, Book, Layers, ChevronRight, Check } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import * as Haptics from 'expo-haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface GlobalSearchBarProps {
  onSearch: (query: string, filters: any) => void;
  placeholder?: string;
  initialQuery?: string;
}

export const GlobalSearchBar: React.FC<GlobalSearchBarProps> = ({ 
  onSearch, 
  placeholder = "Search questions & notes...", 
  initialQuery = "" 
}) => {
  const { colors } = useTheme();
  const [query, setQuery] = useState(initialQuery);
  const [showFilters, setShowFilters] = useState(false);
  
  // -- Filter State (Same as Smart Search) --
  const [examStage, setExamStage] = useState('All');
  const [selectedInstitutes, setSelectedInstitutes] = useState<string[]>([]);
  const [selectedPrograms, setSelectedPrograms] = useState<string[]>([]);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [selectedMicrotopics, setSelectedMicrotopics] = useState<string[]>([]);
  const [pyqFilter, setPyqFilter] = useState('All');
  const [pyqCategory, setPyqCategory] = useState<string[]>([]);
  const [searchFields, setSearchFields] = useState<string[]>(['Questions']);
  const [searchMode, setSearchMode] = useState<'Matching' | 'Exact'>('Matching');

  // -- Dynamic Filter Data --
  const [institutes, setInstitutes] = useState<string[]>([]);
  const [programs, setPrograms] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [microtopics, setMicrotopics] = useState<string[]>([]);

  // Calculate active filter count for badge
  const activeFilterCount = [
    examStage !== 'All',
    selectedInstitutes.length > 0,
    selectedPrograms.length > 0,
    selectedSubjects.length > 0,
    selectedSections.length > 0,
    selectedMicrotopics.length > 0,
    pyqFilter !== 'All',
    pyqCategory.length > 0,
    searchFields.length !== 1 || !searchFields.includes('Questions'),
    searchMode !== 'Matching'
  ].filter(Boolean).length;

  useEffect(() => {
    fetchFilters();
    fetchDynamicFilters();
  }, [examStage, selectedInstitutes, selectedSubjects, selectedSections]);

  const fetchFilters = async () => {
    try {
      let instQ = supabase.from('tests').select('institute');
      if (examStage && examStage !== 'All') instQ = instQ.ilike('series', `%${examStage}%`);
      const { data: instData } = await instQ;
      if (instData) {
        setInstitutes(Array.from(new Set(instData.map(t => t.institute).filter(Boolean))).sort());
      }

      if (selectedInstitutes.length > 0) {
        let progQ = supabase.from('tests').select('program_name').in('institute', selectedInstitutes);
        if (examStage && examStage !== 'All') progQ = progQ.ilike('series', `%${examStage}%`);
        const { data: progData } = await progQ;
        if (progData) {
          setPrograms(Array.from(new Set(progData.map(t => t.program_name).filter(Boolean))).sort());
        }
      } else {
        setPrograms([]);
      }
    } catch (err) { console.error(err); }
  };

  const fetchDynamicFilters = async () => {
    try {
      let query = supabase.from('questions').select('subject, section_group, micro_topic');
      if (selectedInstitutes.length > 0) {
        const { data: tests } = await supabase.from('tests').select('id').in('institute', selectedInstitutes);
        if (tests) query = query.in('test_id', tests.map(t => t.id));
      }
      const { data } = await query.limit(2000);
      if (data) {
        setSubjects(Array.from(new Set(data.map(q => q.subject).filter(Boolean))).sort());
        
        if (selectedSubjects.length > 0) {
          const secs = Array.from(new Set(data.filter(q => selectedSubjects.includes(q.subject)).map(q => q.section_group))).sort();
          setSections(secs.map(s => s === null ? "General" : s));
        } else {
          setSections([]);
        }

        if (selectedSections.length > 0) {
          const mTopics = Array.from(new Set(
            data.filter(q => 
              selectedSubjects.includes(q.subject) && 
              (selectedSections.includes(q.section_group) || (q.section_group === null && selectedSections.includes("General")))
            ).map(q => q.micro_topic).filter(Boolean)
          )).sort();
          setMicrotopics(mTopics);
        } else {
          setMicrotopics([]);
        }
      }
    } catch (err) { console.error(err); }
  };

  const handleSearch = () => {
    onSearch(query, {
      examStage,
      selectedInstitutes,
      selectedPrograms,
      selectedSubjects,
      selectedSections,
      selectedMicrotopics,
      pyqFilter,
      pyqCategory,
      searchFields,
      searchMode
    });
    Keyboard.dismiss();
  };

  const clearAllFilters = () => {
    setExamStage('All');
    setSelectedInstitutes([]);
    setSelectedPrograms([]);
    setSelectedSubjects([]);
    setSelectedSections([]);
    setSelectedMicrotopics([]);
    setPyqFilter('All');
    setPyqCategory([]);
    setSearchFields(['Questions']);
    setSearchMode('Matching');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const applyFilters = () => {
    setShowFilters(false);
    handleSearch();
  };

  return (
    <View style={styles.container}>
      {/* Search Header UI */}
      <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Search color={colors.textTertiary} size={20} style={styles.searchIcon} />
        <TextInput
          style={[styles.input, { color: colors.textPrimary }]}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            const currentFilters = {
              examStage,
              selectedInstitutes,
              selectedPrograms,
              selectedSubjects,
              selectedSections,
              selectedMicrotopics,
              pyqFilter,
              pyqCategory,
              searchFields,
              searchMode
            };
            if (t === '') onSearch('', currentFilters); // Instant reset
          }}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { 
            setQuery(''); 
            onSearch('', {
              examStage,
              selectedInstitutes,
              selectedPrograms,
              selectedSubjects,
              selectedSections,
              selectedMicrotopics,
              pyqFilter,
              pyqCategory,
              searchFields,
              searchMode
            }); 
          }} style={{ padding: 4 }}>
             <X color={colors.textTertiary} size={18} />
          </TouchableOpacity>
        )}
        <TouchableOpacity 
          style={styles.filterBtn} 
          onPress={() => {
            setShowFilters(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
        >
          <Sliders color={activeFilterCount > 0 ? colors.primary : colors.textTertiary} size={20} />
          {activeFilterCount > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={styles.badgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Filter Bottom Sheet Modal */}
      <Modal
        visible={showFilters}
        animationType="slide"
        transparent
        onRequestClose={() => setShowFilters(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={styles.modalDismisser} 
            activeOpacity={1} 
            onPress={() => setShowFilters(false)} 
          />
            <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
            <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Filters</Text>
              <TouchableOpacity onPress={clearAllFilters}>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>CLEAR ALL</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScroll}>
              <FilterStrip title="Search Mode" items={['Matching', 'Exact']} selected={searchMode} onSelect={setSearchMode} colors={colors} />
              <FilterStrip title="Search Across" items={['Questions', 'Explanations']} selected={searchFields} onSelect={setSearchFields} multi colors={colors} />
              
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              
              <FilterStrip title="Exam Stage" items={['Prelims', 'Mains']} selected={examStage} onSelect={setExamStage} colors={colors} />
              <FilterStrip title="Institutes" items={institutes} selected={selectedInstitutes} onSelect={setSelectedInstitutes} multi colors={colors} />
              {selectedInstitutes.length > 0 && programs.length > 0 && (
                <FilterStrip title="Programs" items={programs} selected={selectedPrograms} onSelect={setSelectedPrograms} multi colors={colors} />
              )}
              
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              
              <FilterStrip title="Subjects" items={subjects} selected={selectedSubjects} onSelect={setSelectedSubjects} multi colors={colors} />
              {sections.length > 0 && <FilterStrip title="Sections" items={sections} selected={selectedSections} onSelect={setSelectedSections} multi colors={colors} />}
              {microtopics.length > 0 && <FilterStrip title="Microtopics" items={microtopics} selected={selectedMicrotopics} onSelect={setSelectedMicrotopics} multi colors={colors} />}

              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              <FilterStrip title="PYQ Filter" items={['PYQ Only', 'Non-PYQ']} selected={pyqFilter} onSelect={setPyqFilter} colors={colors} />
              {pyqFilter === 'PYQ Only' && (
                <FilterStrip title="Exam Category" items={['UPSC', 'Allied', 'Others']} selected={pyqCategory} onSelect={setPyqCategory} multi colors={colors} />
              )}
            </ScrollView>

            <TouchableOpacity 
              style={[styles.applyBtn, { backgroundColor: colors.primary }]} 
              onPress={applyFilters}
            >
              <Text style={styles.applyBtnText}>Apply Filters</Text>
              <Check color="#fff" size={20} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const FilterStrip = ({ title, items, selected, onSelect, colors, multi = false }: any) => {
  const isSelected = (item: string) => {
    if (multi) return Array.isArray(selected) && selected.includes(item);
    return selected === item;
  };

  const handleSelect = (item: string) => {
    if (item === 'All') {
      onSelect(multi ? [] : 'All');
      return;
    }
    if (multi) {
      const prev = Array.isArray(selected) ? selected : [];
      if (prev.includes(item)) onSelect(prev.filter(i => i !== item));
      else onSelect([...prev, item]);
    } else {
      onSelect(item);
    }
  };

  const isAll = !selected || (Array.isArray(selected) && selected.length === 0) || selected === 'All';

  return (
    <View style={styles.stripContainer}>
      <Text style={[styles.stripTitle, { color: colors.textTertiary }]}>{title.toUpperCase()}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
        <TouchableOpacity 
          style={[
            styles.chip, 
            { backgroundColor: colors.surfaceStrong, borderColor: colors.border }, 
            isAll && { backgroundColor: colors.primary, borderColor: colors.primary }
          ]} 
          onPress={() => handleSelect('All')}
        >
          <Text style={[styles.chipText, { color: colors.textSecondary }, isAll && { color: '#fff' }]}>All</Text>
        </TouchableOpacity>
        {items.map((item: string) => (
          <TouchableOpacity 
            key={item} 
            style={[
              styles.chip, 
              { backgroundColor: colors.surfaceStrong, borderColor: colors.border }, 
              isSelected(item) && { backgroundColor: colors.primary, borderColor: colors.primary }
            ]} 
            onPress={() => handleSelect(item)}
          >
            <Text style={[styles.chipText, { color: colors.textSecondary }, isSelected(item) && { color: '#fff' }]}>{item}</Text>
            {multi && isSelected(item) && <Check size={12} color="#fff" style={{ marginLeft: 6 }} />}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    zIndex: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    marginVertical: 8,
  },
  searchIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    height: '100%',
  },
  filterBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '900',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalDismisser: {
    flex: 1,
  },
  modalContent: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '85%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  modalScroll: {
    paddingBottom: 20,
  },
  stripContainer: {
    marginBottom: 20,
  },
  stripTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  chipScroll: {
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 8,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    marginVertical: 12,
    marginBottom: 20,
    opacity: 0.5,
  },
  applyBtn: {
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 10,
  },
  applyBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
