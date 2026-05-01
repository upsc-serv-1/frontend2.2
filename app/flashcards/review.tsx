import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Animated,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  X,
  RotateCcw,
  Check,
  MoreVertical,
  Snowflake,
  Maximize2,
  Pause,
  Image as ImageIcon,
  Trash2,
} from 'lucide-react-native';
import { GestureHandlerRootView, PinchGestureHandler, State } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { FlashcardSvc, CardState } from '../../src/services/FlashcardService';
import { FlashcardLocalCache } from '../../src/services/FlashcardLocalCache';
import { pickAndUploadFlashcardImage } from '../../src/services/ImageUpload';
import { PageWrapper } from '../../src/components/PageWrapper';
import { FlashcardBranchService } from '../../src/services/FlashcardBranchService';

export default function ReviewScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const { microtopic, subject, section, mode, cardId, branchId } = useLocalSearchParams();

  const selectedMicrotopic = Array.isArray(microtopic) ? microtopic[0] : microtopic;
  const selectedSubject = Array.isArray(subject) ? subject[0] : subject;
  const selectedSection = Array.isArray(section) ? section[0] : section;
  const selectedCardId = Array.isArray(cardId) ? cardId[0] : cardId;
  const reviewMode = Array.isArray(mode) ? mode[0] : mode;

  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showCorrect, setShowCorrect] = useState(false);
  const [editorFontSize, setEditorFontSize] = useState(18);
  const baseFontSize = useRef(18);
  const [showZoomIndicator, setShowZoomIndicator] = useState(false);
  const zoomTimer = useRef<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [personalNote, setPersonalNote] = useState('');
  const [nextDueLabel, setNextDueLabel] = useState<string | null>(null);

  const flipAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      if (!session?.user.id) return;
      await loadZoomSetting();
      const saved = await FlashcardLocalCache.loadSession(session.user.id, selectedMicrotopic as string);
      if (saved && saved.queueCardIds.length) {
        const { data } = await supabase.from('cards').select('*').in('id', saved.queueCardIds);
        const byId: Record<string, any> = {};
        (data || []).forEach((c: any) => (byId[c.id] = c));
        setQueue(saved.queueCardIds.map((id) => byId[id]).filter(Boolean));
        setCurrentIndex(saved.currentIndex);
        setIsFlipped(saved.flipped);
        flipAnim.setValue(saved.flipped ? 180 : 0);
        setLoading(false);
        await FlashcardLocalCache.clearSession(session.user.id, selectedMicrotopic as string);
      } else {
        await loadQueue();
      }
    })();
  }, [session, selectedMicrotopic, selectedSubject, selectedSection, reviewMode, selectedCardId]);

  const loadZoomSetting = async () => {
    try {
      const saved = await AsyncStorage.getItem('flashcard_font_size');
      if (saved) {
        const size = parseInt(saved, 10);
        setEditorFontSize(size);
        baseFontSize.current = size;
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadQueue = async () => {
    setLoading(true);
    try {
      let query = supabase.from('cards').select('*');

      if (branchId) {
        const ids = await FlashcardBranchService.getCardsRecursive(session!.user.id, branchId as string);
        if (ids.length > 0) {
          query = query.in('id', ids);
        } else {
          setQueue([]);
          setLoading(false);
          return;
        }
      } else if (selectedMicrotopic) {
        query = query.ilike('subject', selectedSubject).ilike('microtopic', selectedMicrotopic);
        if (selectedSection && selectedSection !== 'General') {
          query = query.ilike('section_group', selectedSection);
        } else {
          query = query.or('section_group.is.null,section_group.ilike.General');
        }
      } else if (selectedSection) {
        query = query.ilike('subject', selectedSubject).ilike('section_group', selectedSection);
      } else if (selectedSubject) {
        query = query.ilike('subject', selectedSubject);
      }

      const { data: baseCards } = await query;
      const baseIds = (baseCards || []).map((c) => c.id);

      const { data: userStates } = await supabase
        .from('user_cards')
        .select('*')
        .eq('user_id', session?.user.id)
        .in('card_id', baseIds);

      const stateMap: Record<string, Partial<CardState>> = {};
      userStates?.forEach((s: any) => (stateMap[s.card_id] = s));

      const now = new Date();
      let filtered = (baseCards || []).map((c: any) => ({ ...c, state: stateMap[c.id] || {} }));

      if (reviewMode === 'due') {
        filtered = filtered.filter((card) => {
          if (card.state?.status === 'frozen') return false;
          const nextReview = card.state?.next_review ? new Date(card.state.next_review) : null;
          if (!nextReview) return true;
          return nextReview <= now;
        });
      }

      let finalQueue = filtered;
      if (selectedCardId) {
        const startIdx = filtered.findIndex((c) => c.id === selectedCardId);
        if (startIdx !== -1) {
          const target = filtered[startIdx];
          const others = filtered.filter((_, i) => i !== startIdx).sort(() => Math.random() - 0.5);
          finalQueue = [target, ...others];
        }
      } else {
        finalQueue = filtered.sort(() => Math.random() - 0.5);
      }

      setQueue(finalQueue);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFlip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.spring(flipAnim, {
      toValue: isFlipped ? 0 : 180,
      friction: 8,
      tension: 10,
      useNativeDriver: true,
    }).start();
    setIsFlipped(!isFlipped);
  }, [isFlipped, flipAnim]);

  const nextCard = () => {
    if (currentIndex < queue.length - 1) {
      flipAnim.setValue(0);
      setIsFlipped(false);
      setSelectedOption(null);
      setShowCorrect(false);
      setCurrentIndex(currentIndex + 1);
    } else {
      Alert.alert('Session Complete', "You've finished all cards in this session!", [
        { text: 'Done', onPress: () => router.back() },
      ]);
    }
  };

  const rate = async (quality: number) => {
    const card = queue[currentIndex];
    if (!card || !session?.user.id) return;

    try {
      const sm = await FlashcardLocalCache.reviewCardSafe(session.user.id, card.id, quality);
      setNextDueLabel(`+${sm.interval_days}d`);
      setIsFlipped(false);
      setShowCorrect(false);
      flipAnim.setValue(0);
      nextCard();
    } catch (err) {
      Alert.alert('Error', 'Could not save review.');
      console.error(err);
    }
  };

  const freezeCard = async () => {
    const card = queue[currentIndex];
    if (!card || !session?.user.id) return;
    try {
      await FlashcardSvc.freezeCard(session.user.id, card.id);
      const nextQueue = queue.filter((_, i) => i !== currentIndex);
      setQueue(nextQueue);
      if (currentIndex >= nextQueue.length) {
        if (nextQueue.length === 0) router.back();
        else setCurrentIndex(0);
      }
      setIsFlipped(false);
      flipAnim.setValue(0);
    } catch (err) {
      console.error(err);
    }
  };

  const savePersonalNote = async () => {
    const card = queue[currentIndex];
    if (!card || !session?.user.id) return;
    try {
      await FlashcardSvc.saveNote(session.user.id, card.id, personalNote);
      setShowEditModal(false);
      const nextQueue = [...queue];
      nextQueue[currentIndex].state = nextQueue[currentIndex].state || {};
      nextQueue[currentIndex].state.user_note = personalNote;
      setQueue(nextQueue);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteCurrentCard = async () => {
    const card = queue[currentIndex];
    if (!card || !session?.user.id) return;

    Alert.alert(
      "Delete Card",
      "Are you sure you want to permanently remove this card from your deck?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: async () => {
            try {
              setShowEditModal(false);
              await FlashcardSvc.deleteCard(session.user.id, card.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              
              // Remove from local queue and move to next or exit
              const nextQueue = queue.filter((_, i) => i !== currentIndex);
              setQueue(nextQueue);
              
              if (nextQueue.length === 0) {
                router.back();
              } else if (currentIndex >= nextQueue.length) {
                setCurrentIndex(0);
                setIsFlipped(false);
                flipAnim.setValue(0);
              } else {
                // Same index, new card
                setIsFlipped(false);
                flipAnim.setValue(0);
              }
            } catch (err) {
              console.error(err);
              Alert.alert("Error", "Failed to delete card.");
            }
          }
        }
      ]
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;

  if (queue.length === 0) {
    return (
      <View style={styles.center}>
        <Check size={64} color={colors.primary} />
        <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>Deck Clear!</Text>
        <Text style={[styles.emptySub, { color: colors.textTertiary }]}>No cards due for review in this topic.</Text>
        <TouchableOpacity style={[styles.doneBtn, { backgroundColor: colors.primary }]} onPress={() => router.back()}>
          <Text style={styles.doneBtnText}>Return to Dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const onPinchGestureEvent = (event: any) => {
    const scale = event.nativeEvent.scale;
    let nextSize = baseFontSize.current * scale;
    nextSize = Math.max(12, Math.min(40, nextSize));
    setEditorFontSize(Math.round(nextSize));
    setShowZoomIndicator(true);
    if (zoomTimer.current) clearTimeout(zoomTimer.current);
    zoomTimer.current = setTimeout(() => setShowZoomIndicator(false), 1500);
  };

  const onPinchHandlerStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END) {
      baseFontSize.current = editorFontSize;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      AsyncStorage.setItem('flashcard_font_size', editorFontSize.toString()).catch(console.error);
    }
  };

  const currentCard = queue[currentIndex];
  const frontInterpolate = flipAnim.interpolate({ inputRange: [0, 180], outputRange: ['0deg', '180deg'] });
  const backInterpolate = flipAnim.interpolate({ inputRange: [0, 180], outputRange: ['180deg', '360deg'] });

  return (
    <PageWrapper>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <X size={24} color={colors.textPrimary} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={async () => {
              if (!session?.user.id) return router.back();
              await FlashcardLocalCache.saveSession(session.user.id, {
                microtopic: (selectedMicrotopic as string) || 'general',
                subject: (selectedSubject as string) || 'General',
                section: (selectedSection as string) || 'General',
                queueCardIds: queue.map((q) => q.id),
                currentIndex,
                flipped: isFlipped,
                savedAt: new Date().toISOString(),
              });
              Alert.alert('Paused', 'Session saved. Resume from the microtopic screen.', [
                { text: 'OK', onPress: () => router.back() },
              ]);
            }}
            style={styles.headerBtn}
          >
            <Pause size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={[styles.progressText, { color: colors.textTertiary }]}>
              {currentIndex + 1} of {queue.length}
            </Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${((currentIndex + 1) / queue.length) * 100}%`, backgroundColor: colors.primary }]} />
            </View>
          </View>

          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => {
              setPersonalNote(currentCard.state?.user_note || '');
              setShowEditModal(true);
            }}
          >
            <MoreVertical size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <GestureHandlerRootView style={{ flex: 1 }}>
          <PinchGestureHandler onGestureEvent={onPinchGestureEvent} onHandlerStateChange={onPinchHandlerStateChange}>
            <View style={styles.cardSection}>
              <View style={styles.cardTouch}>
                <Animated.View
                  style={[
                    styles.card,
                    {
                      transform: [{ perspective: 1000 }, { rotateY: frontInterpolate }],
                      opacity: flipAnim.interpolate({ inputRange: [89, 90], outputRange: [1, 0] }),
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.cardSideLabel, { color: colors.primary }]}>QUESTION</Text>

                  <ScrollView 
                    style={{ flex: 1 }} 
                    contentContainerStyle={[styles.cardScroll, { padding: 16 }]}
                    showsVerticalScrollIndicator
                    nestedScrollEnabled
                  >

                    {/* Render Main Text and Interactive Options */}
                    {(() => {
                      let meta = currentCard.source;
                      if (typeof meta === 'string') {
                        try { meta = JSON.parse(meta); } catch(e) { meta = {}; }
                      }

                      let options = (meta as any)?.options || currentCard.options || {};
                      if (typeof options === 'string') {
                        try {
                          options = JSON.parse(options);
                        } catch {
                          options = {};
                        }
                      }

                      if (Array.isArray(options)) {
                        options = options.reduce((acc: Record<string, string>, value: any, idx: number) => {
                          const key = String.fromCharCode(97 + idx); // a,b,c,d
                          acc[key] = String(value ?? '').trim();
                          return acc;
                        }, {});
                      }

                      const normalizedOptions: Record<string, string> = Object.entries(options || {}).reduce(
                        (acc: Record<string, string>, [k, v]) => {
                          acc[String(k).trim().toLowerCase()] = String(v ?? '').trim();
                          return acc;
                        },
                        {}
                      );

                      let rawText = (currentCard.front_text || currentCard.question_text || currentCard.question || '').trim();

                      // REPAIR: If options missing from metadata, extract from rawText.
                      // Priority 1: Alphabetic (A)-(E)
                      // Priority 2: Numeric (1)-(5) only if no alphabetic found
                      if (Object.keys(normalizedOptions).length === 0 && rawText) {
                        const alphaPatterns = [
                          /[(\[]([A-Ea-e])[)\]]\s*([\s\S]*?)(?=\s*[(\[][A-Ea-e][)\]]|$)/g,
                          /(?:^|\n)\s*([A-Ea-e])[.):]\s+([\s\S]*?)(?=\n\s*[A-Ea-e][.):]\s+|$)/g,
                        ];
                        for (const rgx of alphaPatterns) {
                          let m: RegExpExecArray | null;
                          while ((m = rgx.exec(rawText)) !== null) {
                            const key = m[1].toLowerCase();
                            const val = m[2].trim();
                            if (val && !normalizedOptions[key]) normalizedOptions[key] = val;
                          }
                          if (Object.keys(normalizedOptions).length >= 2) break;
                        }

                        // Only if still no options, try numeric
                        if (Object.keys(normalizedOptions).length === 0) {
                          const numPatterns = [
                            /[(\[]([1-5])[)\]]\s*([\s\S]*?)(?=\s*[(\[][1-5][)\]]|$)/g,
                            /(?:^|\n)\s*([1-5])[.):]\s+([\s\S]*?)(?=\n\s*[1-5][.):]\s+|$)/g,
                          ];
                          for (const rgx of numPatterns) {
                            let m: RegExpExecArray | null;
                            while ((m = rgx.exec(rawText)) !== null) {
                              const key = m[1].toLowerCase();
                              const val = m[2].trim();
                              if (val && !normalizedOptions[key]) normalizedOptions[key] = val;
                            }
                            if (Object.keys(normalizedOptions).length >= 2) break;
                          }
                        }
                      }

                      // Canonical order
                      const orderKey = (k: string) =>
                        /[a-e]/.test(k) ? k.charCodeAt(0) - 97 : parseInt(k, 10) + 100;
                      const optionEntries = Object.entries(normalizedOptions)
                        .sort((x, y) => orderKey(x[0]) - orderKey(y[0]));

                      // Strip ONLY the patterns that match the keys we actually used as options
                      let cleanText = rawText;
                      optionEntries.forEach(([k]) => {
                        const escapedK = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        // Strip (K) or K. or K)
                        const stripRgx = new RegExp(`(?:[(\\[]${escapedK}[)\\]]|(?:^|\\n)\\s*${escapedK}[.):])\\s*[\\s\\S]*?(?=\\s*[(\\[][A-Ea-e1-5][)\\]]|(?:^|\\n)\\s*[A-Ea-e1-5][.):]|$)`, 'gi');
                        cleanText = cleanText.replace(stripRgx, '');
                      });
                      
                      cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();

                      // Deduplicate: If the text contains a large chunk that repeats itself (common in PDF extractions)
                      if (cleanText.length > 120) {
                        const half = Math.floor(cleanText.length / 2);
                        // Try to find a repeat point in the second half
                        // We check the first 40 chars and see if they appear again later
                        const anchor = cleanText.substring(0, 40);
                        const secondOccurrence = cleanText.indexOf(anchor, 20);
                        
                        if (secondOccurrence > half) {
                          // Likely a full repeat
                          cleanText = cleanText.substring(0, secondOccurrence).trim();
                        } else {
                          // Check for "Consider the following..." style repeat in the middle
                          const midAnchor = "Consider the following";
                          const midIdx = cleanText.lastIndexOf(midAnchor);
                          if (midIdx > half && cleanText.indexOf(midAnchor) < midIdx) {
                            cleanText = cleanText.substring(0, midIdx).trim();
                          }
                        }
                      }

                      return (
                        <>
                          <Text style={[styles.cardText, { color: colors.textPrimary, fontSize: editorFontSize, lineHeight: editorFontSize * 1.5, marginBottom: 12 }]}>
                            {cleanText}
                          </Text>

                          {optionEntries.map(([k, v]) => {
                            const optionKey = String(k).toLowerCase();
                            const isSelected = selectedOption === optionKey;
                            const correctRaw = (
                              currentCard.correct_answer ||
                              (meta as any)?.correct_answer ||
                              (meta as any)?.correctAnswer ||
                              ''
                            ).toString().trim().toLowerCase();
                            const correctKeys = correctRaw
                              .split(/[,\s/|]+/)
                              .map((k) => k.replace(/[()[\]]/g, '').trim())
                              .filter(Boolean);
                            const isCorrectOption = correctKeys.includes(optionKey);

                            let optBg = colors.surface;
                            let optBorder = colors.border;

                            if (showCorrect) {
                              if (isCorrectOption) {
                                optBg = '#22c55e15';
                                optBorder = '#22c55e';
                              } else if (isSelected) {
                                optBg = '#ef444415';
                                optBorder = '#ef4444';
                              }
                            } else if (isSelected) {
                              optBg = `${colors.primary}10`;
                              optBorder = colors.primary;
                            }

                            return (
                              <TouchableOpacity
                                key={optionKey}
                                onPress={() => {
                                  if (!isFlipped && !showCorrect) {
                                    setSelectedOption(optionKey);
                                    setShowCorrect(true);
                                    if (isCorrectOption) {
                                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                                    } else {
                                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
                                    }
                                  }
                                }}
                                activeOpacity={0.8}
                                style={{
                                  flexDirection: 'row',
                                  marginTop: 8,
                                  gap: 10,
                                  padding: 10,
                                  borderRadius: 14,
                                  borderWidth: 1.5,
                                  backgroundColor: optBg,
                                  borderColor: optBorder,
                                  minHeight: 48,
                                  alignItems: 'center'
                                }}
                              >
                                <View
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 14,
                                    backgroundColor: isSelected
                                      ? (showCorrect ? (isCorrectOption ? '#22c55e' : '#ef4444') : colors.primary)
                                      : colors.surfaceStrong,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                >
                                  <Text style={{ fontWeight: '900', color: isSelected ? '#fff' : colors.textTertiary, fontSize: 13 }}>
                                    {optionKey.toUpperCase()}
                                  </Text>
                                </View>
                                <Text style={{ flex: 1, color: colors.textPrimary, fontSize: editorFontSize - 4, fontWeight: isSelected ? '700' : '500', lineHeight: (editorFontSize - 4) * 1.3 }}>
                                  {v as string}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </>
                      );
                      })()}


                    {currentCard.front_image_url && (
                      <Image source={{ uri: currentCard.front_image_url }} resizeMode="contain" style={{ width: '100%', height: 200, marginTop: 12, borderRadius: 8 }} />
                    )}
                  </ScrollView>

                  <TouchableOpacity onPress={handleFlip} activeOpacity={0.6} style={styles.flipHint}>
                    <RotateCcw size={14} color={colors.textTertiary} />
                    <Text style={[styles.flipHintText, { color: colors.textTertiary }]}> 
                      {showCorrect ? 'Tap card to see explanation' : 'Select an option or tap to flip'}
                    </Text>
                  </TouchableOpacity>
                </Animated.View>

                <Animated.View
                  style={[
                    styles.card,
                    styles.cardBack,
                    {
                      transform: [{ perspective: 1000 }, { rotateY: backInterpolate }],
                      opacity: flipAnim.interpolate({ inputRange: [89, 90], outputRange: [0, 1] }),
                      backgroundColor: colors.surface,
                      borderColor: `${colors.primary}40`,
                    },
                  ]}
                >
                  <Text style={[styles.cardSideLabel, { color: '#34c759' }]}>ANSWER & EXPLANATION</Text>
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={[styles.cardScroll, { paddingBottom: 24 }]}
                    showsVerticalScrollIndicator
                    nestedScrollEnabled
                  >
                    <Text style={[styles.answerText, { color: colors.textPrimary, fontSize: editorFontSize - 2, lineHeight: (editorFontSize - 2) * 1.5 }]}>
                      {currentCard.back_text || currentCard.answer_text || currentCard.answer}
                    </Text>

                    {Array.isArray(currentCard.institutes) && currentCard.institutes.length > 1 && (
                      <View style={{ marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceStrong || '#f1f5f9' }}>
                        <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, color: colors.textTertiary, marginBottom: 6 }}>
                          APPEARED IN
                        </Text>
                        {currentCard.institutes.map((ins: any, idx: number) => (
                          <Text key={idx} style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
                            • {ins.institute}{ins.year ? ` ${ins.year}` : ''}{ins.correct ? ` — Answer: (${String(ins.correct).toUpperCase()})` : ''}
                          </Text>
                        ))}
                      </View>
                    )}

                    {currentCard.back_image_url && (
                      <Image source={{ uri: currentCard.back_image_url }} style={{ width: '100%', height: 200, borderRadius: 8, marginTop: 12 }} resizeMode="contain" />
                    )}

                    {nextDueLabel && (
                      <View style={{ marginTop: 16, alignItems: 'center' }}>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textTertiary, letterSpacing: 1 }}>
                          NEXT REVIEW IN {nextDueLabel}
                        </Text>
                      </View>
                    )}

                    {currentCard.state?.user_note && (
                      <View style={[styles.noteBox, { backgroundColor: `${colors.primary}10` }]}>
                        <Text style={[styles.noteLabel, { color: colors.primary }]}>PERSONAL NOTE</Text>
                        <Text style={[styles.noteText, { color: colors.textSecondary }]}>{currentCard.state.user_note}</Text>
                      </View>
                    )}
                  </ScrollView>

                  <TouchableOpacity onPress={handleFlip} activeOpacity={0.6} style={styles.flipHint}>
                    <RotateCcw size={14} color={colors.textTertiary} />
                    <Text style={[styles.flipHintText, { color: colors.textTertiary }]}>Tap to see question</Text>
                  </TouchableOpacity>
                </Animated.View>
              </View>
            </View>
          </PinchGestureHandler>
        </GestureHandlerRootView>

        {showZoomIndicator && (
          <View style={styles.zoomIndicator}>
            <Maximize2 size={16} color="#fff" />
            <Text style={styles.zoomText}>{editorFontSize}px</Text>
          </View>
        )}

        <View style={[styles.actions, { borderTopColor: colors.border }]}>
          {isFlipped ? (
            <View style={styles.qualityRow}>
              {[
                { q: 0, label: 'Again', color: '#ef4444' },
                { q: 3, label: 'Hard', color: '#f59e0b' },
                { q: 4, label: 'Good', color: colors.primary },
                { q: 5, label: 'Easy', color: '#22c55e' },
              ].map(({ q, label, color }) => (
                <TouchableOpacity key={label} style={[styles.qBtn, { borderColor: color }]} onPress={() => rate(q)}>
                  <Text style={[styles.qBtnLabel, { color }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <TouchableOpacity style={[styles.showBtn, { backgroundColor: colors.primary }]} onPress={handleFlip}>
              <Text style={styles.showBtnText}>Show Answer</Text>
            </TouchableOpacity>
          )}
        </View>

        <Modal visible={showEditModal} transparent animationType="slide">
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
            style={{ flex: 1 }}
          >
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Edit Card</Text>
                  <TouchableOpacity onPress={() => setShowEditModal(false)}>
                    <X size={24} color={colors.textPrimary} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Personal Notes / Tricks</Text>
                <TextInput
                  style={[styles.noteInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.bg }]}
                  multiline
                  placeholder="Add your own memory aids..."
                  placeholderTextColor={colors.textTertiary}
                  value={personalNote}
                  onChangeText={setPersonalNote}
                />

                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: `${colors.primary}20`, marginBottom: 12 }]}
                  onPress={async () => {
                    if (!session?.user.id) return;
                    const url = await pickAndUploadFlashcardImage(session.user.id);
                    if (!url) return;
                    await supabase.from('cards').update({ back_image_url: url }).eq('id', queue[currentIndex].id);
                    const next = [...queue];
                    next[currentIndex].back_image_url = url;
                    setQueue(next);
                    Alert.alert('Image added', 'Saved to card back.');
                  }}
                >
                  <ImageIcon size={20} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>Add Image to Back</Text>
                </TouchableOpacity>

                <View style={styles.modalActions}>
                  <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#ef444410' }]} onPress={handleDeleteCurrentCard}>
                    <Trash2 size={20} color="#ef4444" />
                    <Text style={{ color: '#ef4444', fontWeight: '700' }}>Delete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#3b82f610' }]} onPress={freezeCard}>
                    <Snowflake size={20} color="#3b82f6" />
                    <Text style={{ color: '#3b82f6', fontWeight: '700' }}>Freeze</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={savePersonalNote}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </PageWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, justifyContent: 'space-between' },
  headerBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  progressText: { fontSize: 12, fontWeight: '800', marginBottom: 4 },
  progressBarBg: { width: 120, height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, overflow: 'hidden' },
  progressBarFill: { height: '100%' },
  cardSection: { flex: 1, padding: 20, justifyContent: 'center' },
  cardTouch: { flex: 1 },
  card: {
    flex: 1,
    borderRadius: 32,
    padding: 16,
    paddingTop: 20,
    borderWidth: 2,
    backfaceVisibility: 'hidden',
    elevation: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  cardBack: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  cardSideLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 20, textAlign: 'center' },
  cardScroll: { flexGrow: 1, paddingBottom: 12 },
  cardText: { fontWeight: '700', textAlign: 'center' },
  answerText: { fontWeight: '600', textAlign: 'center' },
  zoomIndicator: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  zoomText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  flipHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 },
  flipHintText: { fontSize: 13, fontWeight: '600' },
  noteBox: { marginTop: 30, padding: 16, borderRadius: 16 },
  noteLabel: { fontSize: 10, fontWeight: '900', marginBottom: 8 },
  noteText: { fontSize: 14, fontWeight: '500', lineHeight: 22 },
  actions: { padding: 16, borderTopWidth: 1 },
  showBtn: { height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  showBtnText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 22, fontWeight: '900' },
  inputLabel: { fontSize: 14, fontWeight: '700', marginBottom: 12 },
  noteInput: { height: 150, borderRadius: 20, borderWidth: 1, padding: 16, textAlignVertical: 'top', fontSize: 16 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalBtn: { flex: 1, height: 56, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: { fontSize: 24, fontWeight: '900', marginTop: 20 },
  emptySub: { fontSize: 16, textAlign: 'center', marginTop: 8 },
  doneBtn: { marginTop: 32, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 20 },
  doneBtnText: { color: '#fff', fontWeight: '800' },
  qualityRow: { flexDirection: 'row', gap: 6, padding: 16 },
  qBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 2, alignItems: 'center', backgroundColor: '#fff' },
  qBtnLabel: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  qBtnSub: { color: '#64748b', fontSize: 10, marginTop: 2 },
});
