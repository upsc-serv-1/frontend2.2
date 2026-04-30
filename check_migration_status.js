
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
  console.log('--- Checking Columns ---');
  
  // Check user_widgets for is_archived
  const { data: wData, error: wError } = await supabase.from('user_widgets').select('*').limit(1);
  if (wError) console.log('user_widgets error:', wError.message);
  else console.log('user_widgets columns:', Object.keys(wData[0] || {}));

  // Check user_note_nodes for is_archived
  const { data: nData, error: nError } = await supabase.from('user_note_nodes').select('*').limit(1);
  if (nError) console.log('user_note_nodes error:', nError.message);
  else console.log('user_note_nodes columns:', Object.keys(nData[0] || {}));

  console.log('\n--- Checking RPC Functions ---');
  
  // Check for RPC functions by trying to call them with dummy UUIDs
  const dummyId = '00000000-0000-0000-0000-000000000000';
  
  const { error: r1 } = await supabase.rpc('rename_note_node', { p_node_id: dummyId, p_user_id: dummyId, p_title: 'test' });
  if (r1 && r1.code === 'PGRST202') console.log('rename_note_node: MISSING');
  else console.log('rename_note_node: PRESENT (or other error)');

  const { error: r2 } = await supabase.rpc('delete_note_node_cascade', { p_node_id: dummyId, p_user_id: dummyId });
  if (r2 && r2.code === 'PGRST202') console.log('delete_note_node_cascade: MISSING');
  else console.log('delete_note_node_cascade: PRESENT (or other error)');
}

checkSchema();
