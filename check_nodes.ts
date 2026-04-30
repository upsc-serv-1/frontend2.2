import { supabase } from './src/lib/supabase';

async function checkNodes() {
  const { data, error } = await supabase.from('user_note_nodes').select('*').limit(1);
  if (error) console.error('Error:', error);
  else console.log('Node columns:', Object.keys(data[0] || {}));
}
checkNodes();
