# AI Teacher Test Generator

A full Streamlit web application that uses Groq cloud AI to generate, edit, export, practice, analyze, and store teacher-ready tests.

## Project Files

- `app.py` - Main Streamlit application
- `ai_generator.py` - Groq request logic, structured outputs, and smart long-document processing
- `document_loader.py` - PDF, DOCX, and TXT text extraction
- `storage.py` - SQLite + migration/usage/audit storage for users, history, attempts, groups, and question bank
- `quality.py` - Quality validation and readiness checks
- `analytics.py` - Student scoring and analytics
- `variants.py` - A/B/C classroom variants
- `cloud_sync.py` - Supabase cloud-first data layer
- `supabase_schema.sql` - Full Supabase schema for cloud storage
- `requirements.txt` - Python dependencies
- `.env.example` - Example environment variables
- `README.md` - Setup and usage guide
- `PROJECT_DEFENSE_KZ.md` - Ready defense text in Kazakh
- `CRITERIA_MAP_KZ.md` - Mapping to the grading rubric
- `DEMO_SCRIPT.md` - Ready 2-3 minute live demo flow with demo accounts

## Main Features

- Generate tests by topic
- Generate tests from uploaded `PDF`, `DOCX`, and `TXT` study material
- Smart long-document processing:
  - chunking
  - summary before question generation
  - key concept extraction
- Set grade level, lesson stage, assessment purpose, and learning objective
- Set difficulty: `easy`, `medium`, `hard`
- Choose test type:
  - `multiple choice`
  - `true/false`
  - `short answer`
  - `matching`
- Choose generation language:
  - `English`
  - `Russian`
  - `Kazakh`
- Edit generated questions directly in the interface
- Add question explanations and skill tags
- Automatic quality report before export
- Local fallback generator when the AI API is temporarily unavailable
- Build classroom variants:
  - `Variant A`
  - `Variant B`
  - `Variant C`
  - `Variant D`
- Student practice mode with automatic checking
- Analytics dashboard:
  - teacher home dashboard
  - per-test analytics only
  - individual student cards
  - topic progress analytics
  - suspicious-attempt detection
  - total attempts
  - average, median, and pass rate
  - variant gap and performance by variant
  - accuracy by question type
  - topics or skills with the most mistakes
  - hardest questions
  - student risk table
  - skill risk table
  - teacher risk alerts and recommendations
  - weak topics by student
  - progress across multiple tests
- Export each variant in:
  - `Student Version`
  - `Teacher Version`
- Export formats:
  - `TXT`
  - `PDF`
  - `DOCX`
- Local profiles:
  - teacher
  - student
  - guest mode
- Electronic gradebook and roster import
- Groups / classes with CSV/XLSX student import
- Audit log and usage events
- Plan-aware quotas for monetization experiments
- Backup center and local-to-cloud migration helper
- Local SQLite history
- Teacher library with subject tags, favorites, sorting, and quick preview
- Question bank for reusing saved questions
- Shareable student links for each variant
- Student draft saving and duplicate-submission protection
- Student submissions saved to the database
- API error logging for reliability
- Optional Supabase cloud-first database for users, tests, links, attempts, drafts, and logs

## Pedagogical Justification

This application is designed for teachers and future informatics teachers.

- It reduces the time required to create assessment materials.
- It supports revision lessons, formative assessment, homework checking, and exam preparation.
- It adapts tests to grade level and learning objective.
- It gives the teacher full editorial control before students use the material.
- It supports direct classroom use through student mode and analytics.

## Installation

1. Open a terminal in the project folder:

```bash
cd /Users/kuma/Documents/AI_Teacher_Test_Generator
```

2. Create and activate a virtual environment:

```bash
python -m venv .venv
source .venv/bin/activate
```

On Windows:

```bash
.venv\Scripts\activate
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

## Environment Variables

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Open `.env` and set your values:

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-20b
MAX_GENERATION_ATTEMPTS=2
PUBLIC_APP_URL=http://localhost:8501
SUPABASE_URL=
SUPABASE_KEY=
ENABLE_FALLBACK_GENERATOR=1
```

## Local and Cloud Storage

- Local data is stored in `teacher_history.db` when Supabase is not configured
- If Supabase is configured, the app uses cloud-first storage for users, tests, question bank, links, attempts, drafts, groups, audit logs, and usage logs
- Shared student links are generated from the app and point to `PUBLIC_APP_URL?share=<token>`
- Apply `supabase_schema.sql` in Supabase SQL editor before enabling cloud mode
- Re-run `supabase_schema.sql` after major updates so new tables and columns are created safely

## Reliability Checks

Run the local smoke test:

```bash
python smoke_test.py
```

Run the lightweight unit tests:

```bash
python -m unittest discover -s tests
```

## Run the App

```bash
python -m streamlit run app.py
```

## How It Works

1. Sign in locally as a teacher or use guest mode.
2. Enter a topic or upload a `PDF`, `DOCX`, or `TXT` file.
3. Set grade level, difficulty, language, test type, lesson stage, assessment purpose, and learning objective.
4. Generate the test through Groq cloud AI.
5. Review the source summary and extracted key concepts.
6. Edit the generated questions, explanations, and skill tags.
7. Review the quality report and fix any blocking issues.
8. Save useful questions to the question bank.
9. Generate and export `Variant A`, `Variant B`, `Variant C`, and `Variant D`.
10. Create a share link for any variant and send it to students.
11. Students open the link, solve the test, and submit answers.
12. Student answers are saved to the database, drafts are supported, and duplicate submissions are blocked.
13. Teachers can still run student practice mode directly in the app.
14. Save and reload tests from the local history and library.
15. Use subject tags, favorites, preview, and archive tools in the library.
16. Prepare demo accounts and seeded attempts from the sidebar before project defense.

## Suggested Defense Demo

1. Show the pedagogical inputs.
2. Generate a test from a topic.
3. Generate another test from an uploaded file.
4. Edit one question and save it to the question bank.
5. Show the quality report.
6. Export `Variant A` as Student Version and Teacher Version.
7. Run student mode and submit answers.
8. Open the analytics dashboard.
9. Show student cards, weak topics, and progress across multiple tests.
10. Show local history, API error logs, and optional cloud backup readiness.
