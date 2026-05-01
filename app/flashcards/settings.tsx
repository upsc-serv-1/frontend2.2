import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme } from '../../src/context/ThemeContext';
import { SrsSettingsSvc } from '../../src/services/SrsSettingsService';
import { DEFAULT_SRS_SETTINGS, SrsSettings } from '../../src/services/sm2';

export default function SrsSettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const [s, setS] = useState<SrsSettings>(DEFAULT_SRS_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session?.user.id) return;
    SrsSettingsSvc.load(session.user.id).then((x) => { setS(x); setLoading(false); });
  }, [session]);

  const save = async () => {
    if (!session?.user.id) return;
    setSaving(true);
    try { await SrsSettingsSvc.save(session.user.id, s); router.back(); }
    catch (e: any) { Alert.alert('Save failed', e.message || ''); }
    finally { setSaving(false); }
  };

  const reset = () => setS(DEFAULT_SRS_SETTINGS);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />;

  const Field = (props: { label: string; value: string; onChange: (v: string) => void; testID: string }) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textTertiary }]}>{props.label}</Text>
      <TextInput
        testID={props.testID}
        value={props.value}
        onChangeText={props.onChange}
        style={[styles.input, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.surface }]}
      />
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>SRS Settings</Text>

      <Field testID="srs-learning-steps" label="Learning Steps (minutes, comma-separated)"
        value={s.learningStepsMinutes.join(', ')}
        onChange={(v) => setS({ ...s, learningStepsMinutes: v.split(',').map(x => parseInt(x.trim(), 10)).filter(Boolean) })} />

      <Field testID="srs-graduating" label="Graduating Interval (days)"
        value={String(s.graduatingIntervalDays)}
        onChange={(v) => setS({ ...s, graduatingIntervalDays: parseInt(v || '1', 10) })} />

      <Field testID="srs-easy-interval" label="Easy Interval (days)"
        value={String(s.easyIntervalDays)}
        onChange={(v) => setS({ ...s, easyIntervalDays: parseInt(v || '4', 10) })} />

      <Field testID="srs-starting-ease" label="Starting Ease"
        value={String(s.startingEase)}
        onChange={(v) => setS({ ...s, startingEase: parseFloat(v || '2.5') })} />

      <Field testID="srs-easy-bonus" label="Easy Bonus (e.g. 1.30)"
        value={String(s.easyBonus)}
        onChange={(v) => setS({ ...s, easyBonus: parseFloat(v || '1.3') })} />

      <Field testID="srs-interval-modifier" label="Interval Modifier (1.00 = normal)"
        value={String(s.intervalModifier)}
        onChange={(v) => setS({ ...s, intervalModifier: parseFloat(v || '1.0') })} />

      <Field testID="srs-hard-mult" label="Hard Multiplier"
        value={String(s.hardMultiplier)}
        onChange={(v) => setS({ ...s, hardMultiplier: parseFloat(v || '1.2') })} />

      <Field testID="srs-max-interval" label="Max Interval (days)"
        value={String(s.maxIntervalDays)}
        onChange={(v) => setS({ ...s, maxIntervalDays: parseInt(v || '365', 10) })} />

      <TouchableOpacity testID="srs-save" onPress={save} disabled={saving}
        style={[styles.btn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save</Text>}
      </TouchableOpacity>
      <TouchableOpacity testID="srs-reset" onPress={reset} style={[styles.btn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}>
        <Text style={[styles.btnText, { color: colors.textPrimary }]}>Reset to Defaults</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '900', marginBottom: 16 },
  field: { marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15 },
  btn: { padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  btnText: { color: '#fff', fontWeight: '900', letterSpacing: 1 },
});
