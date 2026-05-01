import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { FlashcardSvc } from '../../src/services/FlashcardService';
import { PageWrapper } from '../../src/components/PageWrapper';

export default function CardHistoryScreen() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const router = useRouter();
  const { cardId, title } = useLocalSearchParams<{ cardId: string; title?: string }>();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      if (!session?.user?.id || !cardId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const data = await FlashcardSvc.getLearningHistory(session.user.id, cardId, 100, 0);
        setRows(data);
      } finally {
        setLoading(false);
      }
    })();
  }, [session?.user?.id, cardId]);

  return (
    <PageWrapper>
      <SafeAreaView style={[s.container, { backgroundColor: colors.bg }]}>
        <View style={[s.header, { borderBottomColor: colors.border }]}> 
          <TouchableOpacity onPress={() => router.back()} style={s.back}>
            <ArrowLeft size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: colors.textPrimary }]}>Learning History</Text>
            <Text style={{ color: colors.textTertiary }} numberOfLines={1}>
              {title || 'Card'}
            </Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16 }}
            ListEmptyComponent={<Text style={{ color: colors.textTertiary }}>No learning history yet.</Text>}
            renderItem={({ item }) => (
              <View style={[s.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ color: colors.textPrimary, fontWeight: '800' }}>Quality: {item.quality}</Text>
                <Text style={{ color: colors.textSecondary, marginTop: 4 }}>
                  {new Date(item.reviewed_at).toLocaleString()}
                </Text>
                <Text style={{ color: colors.textTertiary, marginTop: 6 }}>
                  Interval: {item.prev_interval ?? 0}d → {item.new_interval ?? 0}d | EF: {item.prev_ef ?? '-'} →{' '}
                  {item.new_ef ?? '-'}
                </Text>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </PageWrapper>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  title: { fontSize: 18, fontWeight: '900' },
  row: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
});
