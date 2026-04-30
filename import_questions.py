import json
import requests
import os
import time

# Configuration
SUPABASE_URL = "https://ngwsuqzkndlxfoantnlf.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nd3N1cXprbmRseGZvYW50bmxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjA0NjAsImV4cCI6MjA5Mjc5NjQ2MH0.u9-dnMmLXr_5fF243uzx6WyE_vR6dzERDuyFuF-HeZk"
JSON_DIR = "27-4 working file"

def import_all():
    if not os.path.exists(JSON_DIR):
        print(f"Error: {JSON_DIR} not found.")
        return

    files = [f for f in os.listdir(JSON_DIR) if f.endswith(".json")]
    print(f"Found {len(files)} JSON files.")

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }

    for idx, filename in enumerate(files):
        print(f"\n--- Processing [{idx+1}/{len(files)}]: {filename} ---")
        file_path = os.path.join(JSON_DIR, filename)
        
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            if not data or "questions" not in data:
                continue

            # 1. TEST METADATA (Aligned with Website Columns)
            test_id = data.get("id") or filename.replace(".json", "")
            
            test_payload = {
                "id": test_id,
                "title": data.get("title") or test_id,
                "provider": data.get("institute") or "Unknown",
                "institute": data.get("institute") or "Unknown",
                "program_id": data.get("program_id"),
                "program_name": data.get("program_name"),
                "launch_year": data.get("launch_year"),
                "series": data.get("series"),
                "level": data.get("level"),
                "year": data.get("launch_year"),
                "subject": data.get("subject") or (data.get("questions")[0].get("subject") if data.get("questions") else None),
                "subject_test": data.get("subject_test"),
                "section_group": data.get("sectionGroup"),
                "paper_type": data.get("paperType"),
                "question_count": len(data.get("questions", [])),
                "default_minutes": data.get("defaultMinutes"),
                "source_mode": data.get("sourceMode"),
                "is_demo_available": data.get("is_demo_available", False),
                "exam_year": data.get("launch_year")
            }
            
            resp = requests.post(f"{SUPABASE_URL}/rest/v1/tests", json=test_payload, headers=headers)
            if resp.status_code not in [200, 201]:
                print(f"Error upserting test {test_id}: {resp.text}")
                continue

            # 2. QUESTIONS (Aligned with Website Columns)
            question_rows = []
            for q in data.get("questions", []):
                q_id = q.get("id") or f"{test_id}-q{q.get('questionNumber')}"
                
                # Fetch boolean flags and detailed exam info
                is_pyq = q.get("isPyq") or q.get("is_pyq") or False
                is_upsc_cse = False
                is_allied = False
                is_others = False
                
                ei = q.get("exam_info", {})
                if not isinstance(ei, dict):
                    ei = {}

                # Deep extraction from exam_info
                is_pyq = is_pyq or ei.get("isPyq", False) or ei.get("is_pyq", False)
                is_upsc_cse = ei.get("is_upsc_cse") or ei.get("is_upsc_csc") or False
                is_allied = ei.get("is_allied") or False
                is_others = ei.get("is_others") or False
                
                # NCERT detection
                is_ncert = q.get("is_ncert") or q.get("isNcert") or "NCERT" in (q.get("source_attribution_label") or "")
                
                # Determine best source for question text (preserving line breaks)
                stmt_lines = q.get("statementLines") or q.get("statement_line") or q.get("statement_lines")
                if isinstance(stmt_lines, list):
                    q_text = "\n\n".join(stmt_lines)
                elif isinstance(stmt_lines, str):
                    q_text = stmt_lines
                else:
                    q_text = q.get("questionText") or q.get("question_line") or q.get("question_text") or ""

                row = {
                    "id": q_id,
                    "test_id": test_id,
                    "question_number": q.get("questionNumber"),
                    "question_text": q_text,
                    "statement_lines": q.get("statementLines"),
                    "question_blocks": q.get("questionBlocks"),
                    "options": q.get("options"),
                    "correct_answer": q.get("correctAnswer"),
                    "explanation_markdown": q.get("explanationMarkdown"),
                    "source_attribution_label": q.get("source_attribution_label"),
                    "source": ei,
                    "subject": q.get("subject"),
                    "section_group": q.get("sectionGroup"),
                    "micro_topic": q.get("microTopic"),
                    "is_pyq": is_pyq,
                    "is_ncert": q.get("is_ncert", False),
                    "is_upsc_cse": is_upsc_cse,
                    "is_allied": is_allied,
                    "is_others": is_others,
                    "is_cancelled": q.get("is_cancelled", False),
                    "exam": q.get("exam"),
                    "exam_group": q.get("exam_group") or (ei.get("group") if isinstance(ei, dict) else None),
                    "exam_year": q.get("exam_year") or (ei.get("year") if isinstance(ei, dict) else None),
                    "exam_category": q.get("exam_category") or (ei.get("exam_category") if isinstance(ei, dict) else None),
                    "specific_exam": q.get("specific_exam") or (ei.get("specific_exam") if isinstance(ei, dict) else None),
                    "exam_stage": q.get("exam_stage") or data.get("exam_stage") or "Prelims",
                    "exam_paper": q.get("exam_paper")
                }
                question_rows.append(row)

            # Batch Upsert
            batch_size = 50
            for i in range(0, len(question_rows), batch_size):
                batch = question_rows[i:i+batch_size]
                resp = requests.post(f"{SUPABASE_URL}/rest/v1/questions", json=batch, headers=headers)
                if resp.status_code not in [200, 201]:
                    print(f"Error in question batch starting at {i}: {resp.text}")
                
            print(f"Success: {filename} uploaded.")
            time.sleep(0.05)

        except Exception as e:
            print(f"Failed {filename}: {str(e)}")

    print("\nImport process completed.")

if __name__ == "__main__":
    import_all()
