const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
  const { data } = await supabase.from("question_states").select("id, review_tags").not("review_tags", "is", null);
  if (!data) return;
  
  // Mapping from my previous mistake ("Imp", "Fact") AND the original raw tags to the NEW correct tags
  const mapping = {
    // From previous turn
    "imp": "Imp. Fact",
    "fact": "Imp. Concept", // Wait, I should probably mapping "fact" to "Imp. Fact"? 
    // Let's be precise based on original intent:
    // Original "imp.fact" -> "Imp. Fact"
    // Original "imp.concept" -> "Imp. Concept"
    // Original "trap question" -> "Trap Question"
    // Original "must revise" -> "Must Revise"
    
    "Imp": "Imp. Fact",
    "Fact": "Imp. Fact",
    "Concept": "Imp. Concept",
    "Trap": "Trap Question",
    "Revise": "Must Revise",
    
    // Raw tags that might still exist
    "imp.fact": "Imp. Fact",
    "imp fact": "Imp. Fact",
    "imp.concept": "Imp. Concept",
    "imp. concept": "Imp. Concept",
    "trap question": "Trap Question",
    "must revise": "Must Revise"
  };
  
  let count = 0;
  for (const row of data) {
    if (!Array.isArray(row.review_tags)) continue;
    let changed = false;
    const newTags = row.review_tags.map(t => {
      // Check for exact match first, then case-insensitive
      if (mapping[t]) {
        changed = true;
        return mapping[t];
      }
      const lower = String(t).trim().toLowerCase();
      if (mapping[lower]) {
        changed = true;
        return mapping[lower];
      }
      return t;
    });
    if (changed) {
      const uniqueTags = [...new Set(newTags)];
      await supabase.from("question_states").update({ review_tags: uniqueTags }).eq("id", row.id);
      count++;
    }
  }
  console.log("Corrected", count, "rows to full names");
}
run();
