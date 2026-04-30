import { supabase } from './src/lib/supabase';

async function check() {
  const { data, error } = await supabase.from('user_notes').select('*').limit(1);
  if (error) {
    console.error('Error fetching user_notes:', error);
  } else {
    console.log('user_notes columns:', Object.keys(data[0] || {}));
  }
}

check();
