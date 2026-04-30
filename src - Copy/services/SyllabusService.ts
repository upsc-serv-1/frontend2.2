import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SyllabusProgress {
  ncert: boolean;
  pyqs: boolean;
  books: boolean;
  test: boolean;
  mastered: boolean;
  ansWriting?: boolean;
}

export class SyllabusService {
  private static STORAGE_KEY = 'upsc_syllabus_progress';

  static async getProgress(userId: string) {
    try {
      const { data, error } = await supabase
        .from('user_syllabus_progress')
        .select('*')
        .eq('user_id', userId);

      if (error) {
        // If table doesn't exist, fallback to AsyncStorage
        console.warn('user_syllabus_progress table not found, falling back to local storage');
        const local = await AsyncStorage.getItem(this.STORAGE_KEY);
        return local ? JSON.parse(local) : {};
      }

      const progress: Record<string, SyllabusProgress> = {};
      data.forEach((row: any) => {
        progress[row.path] = row.status;
      });
      return progress;
    } catch (e) {
      const local = await AsyncStorage.getItem(this.STORAGE_KEY);
      return local ? JSON.parse(local) : {};
    }
  }

  static async updateProgress(userId: string, path: string, status: SyllabusProgress) {
    try {
      const { error } = await supabase
        .from('user_syllabus_progress')
        .upsert({
          user_id: userId,
          path: path,
          status: status,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,path' });

      if (error) throw error;
    } catch (e) {
      // Fallback
      const local = await AsyncStorage.getItem(this.STORAGE_KEY);
      const data = local ? JSON.parse(local) : {};
      data[path] = status;
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    }
  }
}
