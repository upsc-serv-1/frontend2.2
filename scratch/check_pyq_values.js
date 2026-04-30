
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data, error } = await supabase
    .from('questions')
    .select('exam_stage, exam_paper, exam_year, subject, test_id')
    .eq('is_pyq', true)
    .not('exam_paper', 'is', null)
    .limit(5);
  
  if (error) console.error(error);
  else console.log('Questions with paper:', data);

  const { data: tests } = await supabase.from('tests').select('id, program_id, series, title').ilike('title', '%UPSC%').limit(5);
  console.log('UPSC Tests:', tests);
}

check();
