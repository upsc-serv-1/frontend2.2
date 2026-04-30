import os
import json
from collections import defaultdict

def generate_tally(directory):
    tally = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    file_stats = defaultdict(int)
    
    files = [f for f in os.listdir(directory) if f.endswith(".json")]
    print(f"Found {len(files)} JSON files in {directory}")
    
    for filename in files:
        filepath = os.path.join(directory, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                program_name = data.get("program_name", "Unknown Program")
                questions = data.get("questions", [])
                file_stats[filename] = len(questions)
                
                for q in questions:
                    subject = q.get("subject") or "Unknown Subject"
                    section = q.get("sectionGroup") or "General"
                    microtopic = q.get("microTopic") or "General"
                    tally[subject][section][microtopic] += 1
        except Exception as e:
            print(f"Error processing {filename}: {e}")
                
    return tally, file_stats

def format_as_table(tally):
    lines = ["| Subject | Section | Microtopic | Question Count |", "| :--- | :--- | :--- | :--- |"]
    
    subjects = sorted(tally.keys())
    total_questions = 0
    
    for subject in subjects:
        subject_total = sum(sum(section_dict.values()) for section_dict in tally[subject].values())
        total_questions += subject_total
        lines.append(f"| **{subject}** | | | **{subject_total}** |")
        
        sections = sorted(tally[subject].keys())
        for section in sections:
            section_total = sum(tally[subject][section].values())
            lines.append(f"| | *{section}* | | *{section_total}* |")
            
            microtopics = sorted(tally[subject][section].keys())
            for microtopic in microtopics:
                count = tally[subject][section][microtopic]
                lines.append(f"| | | {microtopic} | {count} |")
        lines.append("| | | | |") # Separator line
                
    return "\n".join(lines), total_questions

if __name__ == "__main__":
    path = r"c:\Users\Dr. Yogesh\Videos\APP FOLDER - V1 - Copy\app\frontend 1.6\27-4 working file"
    tally_data, file_stats = generate_tally(path)
    table, total = format_as_table(tally_data)
    
    output_file = "comprehensive_tally.md"
    with open(output_file, "w", encoding="utf-8") as f:
        f.write("# Comprehensive Question Tally\n\n")
        f.write(f"**Total Questions across all files: {total}**\n\n")
        f.write("## Detailed Breakdown\n\n")
        f.write(table)
        f.write("\n\n## File-wise Stats\n\n")
        f.write("| Filename | Question Count |\n| :--- | :--- |\n")
        for f_name, count in sorted(file_stats.items()):
            f.write(f"| {f_name} | {count} |\n")
    
    print(f"Tally table generated successfully at {output_file}.")
    print(f"Total Questions: {total}")
