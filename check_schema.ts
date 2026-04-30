import { supabase } from './src/lib/supabase';

async function check() {
  const { data, error } = await supabase.from('cards').select('*').limit(1);
  if (error) {
    console.error('Error fetching cards:', error);
    // Try section_group
    const { data: data2, error: error2 } = await supabase.from('cards').select('subject, section_group').limit(1);
    if (error2) console.error('Error fetching cards with section_group:', error2);
    else console.log('Cards has section_group:', Object.keys(data2[0]));
  } else {
    console.log('Cards columns:', Object.keys(data[0] || {}));
  }
}

check();
