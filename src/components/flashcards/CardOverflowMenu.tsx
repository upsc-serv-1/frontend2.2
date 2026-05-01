import React from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import {
  CheckCircle2,
  Pencil,
  Snowflake,
  MoveRight,
  ArrowLeftRight,
  Copy,
  History,
  Trash2,
} from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';

export type CardMenuAction =
  | 'select'
  | 'edit'
  | 'freeze'
  | 'move'
  | 'reverse'
  | 'duplicate'
  | 'history'
  | 'delete';

type Props = {
  visible: boolean;
  frozen: boolean;
  busy?: boolean;
  onClose: () => void;
  onAction: (action: CardMenuAction) => void;
};

export function CardOverflowMenu({ visible, frozen, busy = false, onClose, onAction }: Props) {
  const { colors } = useTheme();

  const Row = ({
    label,
    icon,
    action,
    destructive = false,
  }: {
    label: string;
    icon: React.ReactNode;
    action: CardMenuAction;
    destructive?: boolean;
  }) => (
    <TouchableOpacity
      disabled={busy}
      onPress={() => onAction(action)}
      style={{
        height: 56,
        borderRadius: 14,
        backgroundColor: colors.surfaceStrong,
        paddingHorizontal: 16,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: busy ? 0.7 : 1,
      }}
    >
      {icon}
      <Text style={{ color: destructive ? '#ef4444' : colors.textPrimary, fontSize: 18, fontWeight: '700' }}>
        {label}
      </Text>
      {busy && <ActivityIndicator style={{ marginLeft: 'auto' }} />}
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 18,
            paddingBottom: 28,
          }}
        >
          <Row label="Select" icon={<CheckCircle2 size={22} color={colors.textPrimary} />} action="select" />
          <Row label="Edit" icon={<Pencil size={22} color={colors.textPrimary} />} action="edit" />
          <Row
            label={frozen ? 'Unfreeze' : 'Freeze'}
            icon={<Snowflake size={22} color={colors.textPrimary} />}
            action="freeze"
          />
          <Row label="Move" icon={<MoveRight size={22} color={colors.textPrimary} />} action="move" />
          <Row label="Reverse" icon={<ArrowLeftRight size={22} color={colors.textPrimary} />} action="reverse" />
          <Row label="Duplicate" icon={<Copy size={22} color={colors.textPrimary} />} action="duplicate" />
          <Row label="Learning history" icon={<History size={22} color={colors.textPrimary} />} action="history" />
          <Row label="Delete" icon={<Trash2 size={22} color="#ef4444" />} action="delete" destructive />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
