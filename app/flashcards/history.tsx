import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, RotateCcw } from 'lucide-react-native';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { FlashcardSvc } from '../../src/services/FlashcardService';
import { PageWrapper } from '../../src/components/PageWrapper';

type ReviewRow = {
  id: string;
  reviewed_at: string;
  quality: number;
  prev_interval: number | null;
  new_interval: number | null;
  prev_ef: number | null;
  new_ef: number | null;
};

type Summary = {
  created_at: string;
  next_review: string;
  learning_status: string;
  interval_days: number;
  repetitions: number;
  ease_factor: number;
  avg_review_duration: string | null;
  reviews: ReviewRow[];
};

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return date.toLocaleDateString('en-GB');
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function humanStatus(status: string) {
  if (status === 'not_studied') return 'Not studied';
  if (status === 'learning') return 'Learning';
  if (status === 'mastered') return 'Mastered';
  return status;
}

function qualityMeta(quality: number) {
  if (quality <= 1) {
    return {
      label: 'Again',
      textColor: '#fb7185',
      bgColor: '#3a1a22',
      dotColor: '#fb4b6a',
    };
  }

  if (quality === 2) {
    return {
      label: 'Hard',
      textColor: '#fbbf24',
      bgColor: '#3a3114',
      dotColor: '#f59e0b',
    };
  }

  if (quality >= 4) {
    return {
      label: 'Easy',
      textColor: '#7cc7ff',
      bgColor: '#1b2d45',
      dotColor: '#6ec1ff',
    };
  }

  return {
    label: 'Good',
    textColor: '#7df055',
    bgColor: '#223916',
    dotColor: '#7df055',
  };
}

export default function CardHistoryScreen() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const router = useRouter();
  const { cardId } = useLocalSearchParams<{ cardId: string; title?: string }>();

  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  const loadData = async () => {
    if (!session?.user?.id || !cardId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await FlashcardSvc.getLearningHistorySummary(session.user.id, cardId);
      setSummary(data as Summary);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not load learning history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [session?.user?.id, cardId]);

  const nextReviewLabel = useMemo(() => {
    if (!summary?.next_review) return '-';
    const today = new Date();
    const next = new Date(summary.next_review);
    const isSameDay =
      today.getFullYear() === next.getFullYear() &&
      today.getMonth() === next.getMonth() &&
      today.getDate() === next.getDate();

    return isSameDay ? 'Today' : formatDate(summary.next_review);
  }, [summary?.next_review]);

  const handleResetProgress = async () => {
    if (!session?.user?.id || !cardId || resetting) return;

    Alert.alert(
      'Reset progress?',
      'This will clear card review history and reset scheduling for this card.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              setResetting(true);
              await FlashcardSvc.resetCardProgressForUser(session.user.id, cardId);
              await loadData();
            } catch (error: any) {
              Alert.alert('Reset failed', error?.message || 'Please try again.');
            } finally {
              setResetting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <PageWrapper>
      <SafeAreaView style={[s.container, { backgroundColor: colors.bg }]}>
        <View style={[s.header, { borderBottomColor: colors.border }]}> 
          <TouchableOpacity onPress={() => router.back()} style={s.closeBtn}>
            <ArrowLeft size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.textPrimary }]}>Learning history</Text>
          <View style={s.closeBtn} />
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : !summary ? (
          <View style={s.emptyWrap}>
            <Text style={{ color: colors.textTertiary }}>No learning history available.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={[s.statsCard, { borderColor: colors.border, backgroundColor: colors.surface }]}> 
              <HistoryRow label="Created" value={formatDate(summary.created_at)} colors={colors} />
              <HistoryRow label="Next review" value={nextReviewLabel} colors={colors} />
              <HistoryRow label="Status" value={humanStatus(summary.learning_status)} colors={colors} />
              <HistoryRow label="Interval" value={`${summary.interval_days} days`} colors={colors} />
              <HistoryRow label="Number of reviews" value={`${summary.reviews.length}`} colors={colors} />
              <HistoryRow label="Avg. review duration" value={summary.avg_review_duration || '-'} colors={colors} />
              <HistoryRow label="Ease" value={`${Math.round(summary.ease_factor * 100)}%`} colors={colors} noBorder />
            </View>

            <Text style={[s.timelineTitle, { color: colors.textTertiary }]}>REVIEW HISTORY</Text>

            {summary.reviews.length === 0 ? (
              <Text style={{ color: colors.textTertiary, marginBottom: 24 }}>No review events yet.</Text>
            ) : (
              <View style={s.timelineWrap}>
                {summary.reviews.map((row, index) => {
                  const meta = qualityMeta(row.quality);
                  return (
                    <View key={row.id} style={s.timelineRow}>
                      <View style={s.timelineCol}>
                        {index !== summary.reviews.length - 1 && (
                          <View style={[s.timelineLine, { backgroundColor: colors.border }]} />
                        )}
                        <View style={[s.timelineDot, { backgroundColor: meta.dotColor }]} />
                      </View>

                      <View style={[s.qualityBadge, { backgroundColor: meta.bgColor }]}> 
                        <Text style={[s.qualityText, { color: meta.textColor }]}>{meta.label}</Text>
                      </View>

                      <Text style={[s.reviewTime, { color: colors.textTertiary }]}>{formatDateTime(row.reviewed_at)}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            <TouchableOpacity
              style={[s.resetBtn, { backgroundColor: colors.surfaceStrong, borderColor: colors.border, opacity: resetting ? 0.6 : 1 }]}
              onPress={handleResetProgress}
              disabled={resetting}
            >
              <RotateCcw size={24} color={colors.textPrimary} />
              <Text style={[s.resetText, { color: colors.textPrimary }]}>{resetting ? 'Resetting...' : 'Reset progress'}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </SafeAreaView>
    </PageWrapper>
  );
}

function HistoryRow({
  label,
  value,
  colors,
  noBorder = false,
}: {
  label: string;
  value: string;
  colors: any;
  noBorder?: boolean;
}) {
  return (
    <View style={[s.row, !noBorder && { borderBottomColor: colors.border, borderBottomWidth: 1 }]}> 
      <Text style={[s.rowLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[s.rowValue, { color: colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 24, fontWeight: '800' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: 16, paddingBottom: 36 },
  statsCard: { borderWidth: 1, borderRadius: 18, marginBottom: 18, overflow: 'hidden' },
  row: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  rowLabel: { fontSize: 22, fontWeight: '500' },
  rowValue: { fontSize: 22, fontWeight: '700', textTransform: 'capitalize' },
  timelineTitle: { fontSize: 15, fontWeight: '800', marginBottom: 12 },
  timelineWrap: { marginBottom: 24 },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    minHeight: 82,
  },
  timelineCol: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    alignSelf: 'stretch',
  },
  timelineLine: {
    position: 'absolute',
    width: 3,
    top: 20,
    bottom: -14,
    borderRadius: 2,
  },
  timelineDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginTop: 6,
  },
  qualityBadge: {
    width: 120,
    height: 72,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  qualityText: { fontSize: 22, fontWeight: '700' },
  reviewTime: { fontSize: 20, fontWeight: '500', flex: 1 },
  resetBtn: {
    height: 62,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  resetText: { fontSize: 20, fontWeight: '700' },
});
