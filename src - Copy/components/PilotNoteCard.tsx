import React, { useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';
import { FileText, ChevronRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { PilotNoteNode } from '../hooks/useNotesPilotVault';

interface PilotNoteCardProps {
  note: PilotNoteNode;
}

export const PilotNoteCard = ({ note }: PilotNoteCardProps) => {
  const { colors } = useTheme();
  const router = useRouter();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
      tension: 100,
      friction: 5
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 5
    }).start();
  };

  const handlePress = () => {
    if (note.note_id) {
      // Small delay to let the slide animation feel natural
      setTimeout(() => {
        router.push({ 
          pathname: '/notes/editor', 
          params: { 
            id: note.note_id,
            title: note.title,
            subject: note.subject || 'General'
          } 
        });
      }, 50);
    }
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity 
        activeOpacity={0.9} 
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: 'rgba(255, 255, 255, 0.4)' }]}
      >
        <View style={[styles.iconBox, { backgroundColor: colors.primary + '15' }]}>
          <FileText size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.titleText, { color: colors.textPrimary }]} numberOfLines={1}>
            {note.title}
          </Text>
          <Text style={[styles.dateText, { color: colors.textTertiary }]}>
            {new Date(note.updated_at).toLocaleDateString()}
          </Text>
        </View>
        <ChevronRight size={14} color={colors.textTertiary} />
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 6,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.01,
    shadowRadius: 4,
    elevation: 1,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleText: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  dateText: {
    fontSize: 10,
    fontWeight: '600',
  }
});
