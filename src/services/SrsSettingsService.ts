import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { DEFAULT_SRS_SETTINGS, SrsSettings } from './sm2';

const KEY = (uid: string) => `srs_settings_${uid}`;

function fromJson(j: any): SrsSettings {
  return {
    learningStepsMinutes:    j?.learning_steps_minutes    ?? DEFAULT_SRS_SETTINGS.learningStepsMinutes,
    graduatingIntervalDays:  j?.graduating_interval_days  ?? DEFAULT_SRS_SETTINGS.graduatingIntervalDays,
    easyIntervalDays:        j?.easy_interval_days        ?? DEFAULT_SRS_SETTINGS.easyIntervalDays,
    startingEase:    Number(j?.starting_ease     ?? DEFAULT_SRS_SETTINGS.startingEase),
    easyBonus:       Number(j?.easy_bonus        ?? DEFAULT_SRS_SETTINGS.easyBonus),
    intervalModifier:Number(j?.interval_modifier ?? DEFAULT_SRS_SETTINGS.intervalModifier),
    hardMultiplier:  Number(j?.hard_multiplier   ?? DEFAULT_SRS_SETTINGS.hardMultiplier),
    maxIntervalDays: j?.max_interval_days        ?? DEFAULT_SRS_SETTINGS.maxIntervalDays,
    minEase:         DEFAULT_SRS_SETTINGS.minEase,
    leechThreshold:  DEFAULT_SRS_SETTINGS.leechThreshold,
  };
}

function toJsonMerge(prev: any, s: SrsSettings) {
  return {
    ...(prev || {}),
    easy:  prev?.easy  ?? 7,
    good:  prev?.good  ?? 3,
    hard:  prev?.hard  ?? 1,
    again: prev?.again ?? 0,
    learning_steps_minutes:   s.learningStepsMinutes,
    graduating_interval_days: s.graduatingIntervalDays,
    easy_interval_days:       s.easyIntervalDays,
    starting_ease:            s.startingEase,
    easy_bonus:               s.easyBonus,
    interval_modifier:        s.intervalModifier,
    hard_multiplier:          s.hardMultiplier,
    max_interval_days:        s.maxIntervalDays,
  };
}

export const SrsSettingsSvc = {
  async load(userId: string): Promise<SrsSettings> {
    const cached = await AsyncStorage.getItem(KEY(userId));
    if (cached) { try { return { ...DEFAULT_SRS_SETTINGS, ...JSON.parse(cached) }; } catch {} }
    const { data } = await supabase
      .from('user_settings').select('deck_intervals').eq('user_id', userId).maybeSingle();
    const s = fromJson(data?.deck_intervals);
    await AsyncStorage.setItem(KEY(userId), JSON.stringify(s));
    return s;
  },
  async save(userId: string, s: SrsSettings) {
    await AsyncStorage.setItem(KEY(userId), JSON.stringify(s));
    const { data } = await supabase
      .from('user_settings').select('deck_intervals').eq('user_id', userId).maybeSingle();
    const merged = toJsonMerge(data?.deck_intervals, s);
    await supabase.from('user_settings')
      .upsert({ user_id: userId, deck_intervals: merged, updated_at: new Date().toISOString() },
              { onConflict: 'user_id' });
  },
};
