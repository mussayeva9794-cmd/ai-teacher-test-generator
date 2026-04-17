"""Groq integration, smart source processing, and structured test generation."""

from __future__ import annotations

import json
import os
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI


load_dotenv()


DEFAULT_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
MAX_GENERATION_ATTEMPTS = int(os.getenv("MAX_GENERATION_ATTEMPTS", "2"))
SUMMARY_CHUNK_SIZE = int(os.getenv("SUMMARY_CHUNK_SIZE", "3500"))
SUMMARY_THRESHOLD = int(os.getenv("SUMMARY_THRESHOLD", "4500"))
ENABLE_FALLBACK_GENERATOR = os.getenv("ENABLE_FALLBACK_GENERATOR", "1") == "1"

DIFFICULTY_LABELS = {
    "easy": "easy",
    "medium": "medium",
    "hard": "hard",
}

TEST_TYPE_LABELS = {
    "multiple_choice": "multiple choice",
    "true_false": "true/false",
    "short_answer": "short answer",
    "matching": "matching",
}

LANGUAGE_LABELS = {
    "english": "English",
    "russian": "Russian",
    "kazakh": "Kazakh",
}

TRUE_FALSE_OPTIONS = {
    "english": ["True", "False"],
    "russian": ["Верно", "Неверно"],
    "kazakh": ["Дұрыс", "Қате"],
}

LANGUAGE_PACK = {
    "english": {
        "title_suffix": "Assessment",
        "instructions": "Read each question carefully and answer all items.",
        "mc_question": "Which statement best matches the core idea of {topic}?",
        "tf_question": "This statement correctly describes {topic}.",
        "sa_question": "Write one short explanation of {topic}.",
        "match_question": "Match each concept from {topic} with its correct description.",
        "explanation_prefix": "This answer reflects the main concept of",
        "skill_prefix": "Topic skill",
    },
    "russian": {
        "title_suffix": "Проверочная работа",
        "instructions": "Внимательно прочитайте каждый вопрос и выполните все задания.",
        "mc_question": "Какое утверждение лучше всего отражает основную идею темы «{topic}»?",
        "tf_question": "Это утверждение верно описывает тему «{topic}».",
        "sa_question": "Кратко объясните тему «{topic}».",
        "match_question": "Соотнесите понятия по теме «{topic}» с их описаниями.",
        "explanation_prefix": "Этот ответ отражает основную идею темы",
        "skill_prefix": "Навык по теме",
    },
    "kazakh": {
        "title_suffix": "Тексеру жұмысы",
        "instructions": "Әр сұрақты мұқият оқып, барлық тапсырманы орындаңыз.",
        "mc_question": "{topic} тақырыбының негізгі идеясын қай тұжырым дәл көрсетеді?",
        "tf_question": "Бұл тұжырым {topic} тақырыбын дұрыс сипаттайды.",
        "sa_question": "{topic} тақырыбын қысқаша түсіндіріңіз.",
        "match_question": "{topic} тақырыбы бойынша ұғымдарды дұрыс сипаттамаларымен сәйкестендіріңіз.",
        "explanation_prefix": "Бұл жауап",
        "skill_prefix": "Тақырып дағдысы",
    },
}


def get_client() -> OpenAI:
    """Create a Groq client using the OpenAI-compatible SDK."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY is missing. Add it to your .env file.")

    return OpenAI(
        api_key=api_key,
        base_url="https://api.groq.com/openai/v1",
    )


def build_summary_schema() -> dict[str, Any]:
    """Return the schema used for source summarization."""
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "summary": {"type": "string"},
            "key_concepts": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["summary", "key_concepts"],
    }


def build_response_schema(test_type: str) -> dict[str, Any]:
    """Build a strict JSON schema for Groq structured outputs."""
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "title": {"type": "string"},
            "instructions": {"type": "string"},
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "type": {"type": "string", "enum": [test_type]},
                        "question": {"type": "string"},
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "correct_answer": {"type": "string"},
                        "explanation": {"type": "string"},
                        "skill_tag": {"type": "string"},
                        "pairs": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "left": {"type": "string"},
                                    "right": {"type": "string"},
                                },
                                "required": ["left", "right"],
                            },
                        },
                    },
                    "required": [
                        "type",
                        "question",
                        "options",
                        "correct_answer",
                        "explanation",
                        "skill_tag",
                        "pairs",
                    ],
                },
            },
        },
        "required": ["title", "instructions", "questions"],
    }


def split_text(text: str, chunk_size: int = SUMMARY_CHUNK_SIZE) -> list[str]:
    """Split a long source text into manageable chunks."""
    cleaned = text.strip()
    if len(cleaned) <= chunk_size:
        return [cleaned]

    chunks = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + chunk_size)
        chunk = cleaned[start:end]
        if end < len(cleaned):
            last_break = max(chunk.rfind("\n"), chunk.rfind(". "), chunk.rfind(" "))
            if last_break > 0:
                chunk = chunk[:last_break]
                end = start + last_break
        chunks.append(chunk.strip())
        start = end
    return [chunk for chunk in chunks if chunk]


def extract_json_content(raw_content: str) -> dict[str, Any]:
    """Extract a JSON object from model output."""
    cleaned = raw_content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.replace("json", "", 1).strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise RuntimeError("The AI response could not be parsed as JSON.") from None
        try:
            return json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as error:
            raise RuntimeError("The AI response returned invalid JSON.") from error


def parse_response_content(response: Any) -> dict[str, Any]:
    """Parse structured output content from the completion response."""
    message = response.choices[0].message
    content = message.content
    if not content:
        raise RuntimeError("The AI service returned an empty response.")
    return extract_json_content(content)


def should_fallback_to_json_mode(error: Exception) -> bool:
    """Return whether the error suggests structured output validation failed."""
    message = str(error).lower()
    return (
        "json_validate_failed" in message
        or "failed to validate json" in message
        or "invalid_request_error" in message
    )


def summarize_chunk(client: OpenAI, chunk: str, language: str) -> dict[str, Any]:
    """Summarize one source chunk into concise pedagogical context."""
    response = client.chat.completions.create(
        model=DEFAULT_MODEL,
        temperature=0.3,
        messages=[
            {
                "role": "system",
                "content": "You summarize educational text into concise structured JSON.",
            },
            {
                "role": "user",
                "content": (
                    f"Summarize this educational source in {LANGUAGE_LABELS[language]}. "
                    "Return JSON only with a short summary and key concepts.\n\n"
                    f"{chunk}"
                ),
            },
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "source_summary",
                "strict": True,
                "schema": build_summary_schema(),
            },
        },
    )
    return parse_response_content(response)


def summarize_chunk_fallback(client: OpenAI, chunk: str, language: str) -> dict[str, Any]:
    """Fallback summarization using json_object mode instead of strict schema."""
    response = client.chat.completions.create(
        model=DEFAULT_MODEL,
        temperature=0.2,
        messages=[
            {
                "role": "system",
                "content": "You summarize educational text into compact JSON.",
            },
            {
                "role": "user",
                "content": (
                    f"Summarize this educational source in {LANGUAGE_LABELS[language]}. "
                    "Return only JSON with keys summary and key_concepts.\n\n"
                    f"{chunk}"
                ),
            },
        ],
        response_format={"type": "json_object"},
    )
    return parse_response_content(response)


def prepare_source_context(client: OpenAI, source_material: str, language: str) -> dict[str, Any]:
    """Build a smarter source context for long materials."""
    if not source_material.strip():
        return {
            "summary": "",
            "key_concepts": [],
            "processed_source": "",
        }

    if len(source_material) <= SUMMARY_THRESHOLD:
        return {
            "summary": source_material[:SUMMARY_THRESHOLD],
            "key_concepts": [],
            "processed_source": source_material,
        }

    chunks = split_text(source_material)
    chunk_summaries = []
    for chunk in chunks:
        try:
            chunk_summaries.append(summarize_chunk(client, chunk, language))
        except Exception as error:
            if should_fallback_to_json_mode(error):
                chunk_summaries.append(summarize_chunk_fallback(client, chunk, language))
            else:
                raise

    combined_summary = "\n".join(item.get("summary", "").strip() for item in chunk_summaries if item.get("summary"))
    concept_set: list[str] = []
    for item in chunk_summaries:
        for concept in item.get("key_concepts", []):
            concept_text = str(concept).strip()
            if concept_text and concept_text not in concept_set:
                concept_set.append(concept_text)

    return {
        "summary": combined_summary.strip(),
        "key_concepts": concept_set[:12],
        "processed_source": combined_summary.strip(),
    }


def build_prompt(
    topic: str,
    question_count: int,
    difficulty: str,
    test_type: str,
    language: str,
    grade_level: str = "",
    learning_objective: str = "",
    lesson_stage: str = "",
    assessment_purpose: str = "",
    source_material: str = "",
    source_name: str = "",
    source_summary: str = "",
    key_concepts: list[str] | None = None,
) -> str:
    """Build the prompt for the AI model."""
    readable_type = TEST_TYPE_LABELS[test_type]
    readable_language = LANGUAGE_LABELS[language]
    readable_difficulty = DIFFICULTY_LABELS[difficulty]
    true_false_hint = TRUE_FALSE_OPTIONS[language]

    pedagogical_context = f"""
Pedagogical context:
- Grade level: {grade_level or "not specified"}
- Learning objective: {learning_objective or "not specified"}
- Lesson stage: {lesson_stage or "not specified"}
- Assessment purpose: {assessment_purpose or "not specified"}
- Adapt the wording and cognitive load to this context.
"""

    school_tuning = """
School-focused generation rules:
- Prefer classroom-ready wording over encyclopedic wording.
- Keep distractors plausible but not misleading.
- Avoid two questions that test the exact same fact in slightly different words.
- Explanations must mention why the chosen answer is better than the alternatives.
- When the grade level is lower, keep sentence length shorter and vocabulary simpler.
- When the grade level is higher, increase reasoning depth without becoming vague.
""".strip()

    source_instructions = ""
    if source_material.strip() or source_summary.strip():
        source_label = source_name or "uploaded material"
        concept_text = ", ".join(key_concepts or [])
        source_instructions = f"""
Use the uploaded study material as the primary source.
- Base the questions on the source content and its concepts.
- Stay close to the source and avoid unrelated generic facts.
- Source file name: {source_label}
- Key concepts: {concept_text or "not extracted"}

Source summary:
{source_summary or source_material}
"""

    return f"""
Generate a teacher-ready test about "{topic}".

Output requirements:
- Write all content in {readable_language}.
- Generate exactly {question_count} questions.
- Difficulty level: {readable_difficulty}.
- Test type: {readable_type}.
- Return valid JSON only.
- Each question must include:
  - a question
  - the correct answer
  - a short teacher explanation of why the answer is correct
  - a short skill tag or topic label for analytics

Content rules by test type:
- For "multiple_choice": provide exactly 4 options and exactly 1 correct answer.
- For "true_false": provide exactly 2 options using labels close to {true_false_hint[0]} and {true_false_hint[1]}.
- For "short_answer": leave "options" empty and provide a concise expected answer.
- For "matching": create exactly 4 pairs inside "pairs" and leave "options" empty.

General rules:
- Avoid duplicate questions.
- Keep the structure clear and teacher-friendly.
- The explanation should be short, useful, and pedagogically clear.
- The skill tag should name the main concept being assessed.
- "title" should be a concise descriptive test title.
- "instructions" should be one short student-facing instruction line.
{pedagogical_context}
{school_tuning}
{source_instructions}
""".strip()


def normalize_text(value: str) -> str:
    """Normalize text for duplicate detection."""
    return " ".join(str(value).lower().split())


def normalize_pairs(raw_pairs: Any) -> list[dict[str, str]]:
    """Normalize matching pairs."""
    if not isinstance(raw_pairs, list):
        return []
    pairs = []
    for pair in raw_pairs:
        if isinstance(pair, dict):
            pairs.append(
                {
                    "left": str(pair.get("left", "")).strip(),
                    "right": str(pair.get("right", "")).strip(),
                }
            )
    return pairs


def normalize_question(raw_question: Any, test_type: str, language: str) -> dict[str, Any]:
    """Normalize a generated question into the app schema."""
    if not isinstance(raw_question, dict):
        raw_question = {}

    question_text = str(raw_question.get("question", "")).strip()
    explanation = str(raw_question.get("explanation", "")).strip()
    skill_tag = str(raw_question.get("skill_tag", "")).strip()

    if test_type == "multiple_choice":
        raw_options = raw_question.get("options", [])
        options = [str(option).strip() for option in raw_options[:4]] if isinstance(raw_options, list) else []
        while len(options) < 4:
            options.append("")
        return {
            "type": test_type,
            "question": question_text,
            "options": options,
            "correct_answer": str(raw_question.get("correct_answer", "")).strip(),
            "explanation": explanation,
            "skill_tag": skill_tag,
            "pairs": [],
        }

    if test_type == "true_false":
        raw_options = raw_question.get("options", [])
        options = [str(option).strip() for option in raw_options[:2]] if isinstance(raw_options, list) else []
        if len(options) < 2:
            options = TRUE_FALSE_OPTIONS[language]
        return {
            "type": test_type,
            "question": question_text,
            "options": options,
            "correct_answer": str(raw_question.get("correct_answer", "")).strip(),
            "explanation": explanation,
            "skill_tag": skill_tag,
            "pairs": [],
        }

    if test_type == "short_answer":
        return {
            "type": test_type,
            "question": question_text,
            "options": [],
            "correct_answer": str(raw_question.get("correct_answer", "")).strip(),
            "explanation": explanation,
            "skill_tag": skill_tag,
            "pairs": [],
        }

    pairs = normalize_pairs(raw_question.get("pairs", []))
    while len(pairs) < 4:
        pairs.append({"left": "", "right": ""})
    return {
        "type": "matching",
        "question": question_text,
        "options": [],
        "correct_answer": "",
        "explanation": explanation,
        "skill_tag": skill_tag,
        "pairs": pairs[:4],
    }


def normalize_test_payload(
    payload: dict[str, Any],
    topic: str,
    question_count: int,
    test_type: str,
    language: str,
    grade_level: str,
    learning_objective: str,
    lesson_stage: str,
    assessment_purpose: str,
    source_summary: str,
    key_concepts: list[str],
) -> dict[str, Any]:
    """Normalize the generated payload so the UI can edit and export it."""
    raw_questions = payload.get("questions", [])
    if not isinstance(raw_questions, list):
        raw_questions = []

    questions = [
        normalize_question(item, test_type=test_type, language=language)
        for item in raw_questions[:question_count]
    ]
    while len(questions) < question_count:
        questions.append(normalize_question({}, test_type=test_type, language=language))

    return {
        "title": str(payload.get("title", "")).strip() or f"{topic} Test",
        "instructions": str(payload.get("instructions", "")).strip(),
        "topic": topic,
        "language": language,
        "test_type": test_type,
        "grade_level": grade_level,
        "learning_objective": learning_objective,
        "lesson_stage": lesson_stage,
        "assessment_purpose": assessment_purpose,
        "source_summary": source_summary,
        "key_concepts": key_concepts,
        "questions": questions,
    }


def validate_normalized_test(payload: dict[str, Any], question_count: int) -> None:
    """Validate the normalized test structure after generation."""
    questions = payload.get("questions", [])
    if len(questions) != question_count:
        raise RuntimeError("The AI response did not contain the expected number of questions.")

    normalized_questions = [normalize_text(question.get("question", "")) for question in questions]
    non_empty_questions = [value for value in normalized_questions if value]
    if len(set(non_empty_questions)) != len(non_empty_questions):
        raise RuntimeError("The AI generated duplicate or near-duplicate questions.")

    for index, question in enumerate(questions, start=1):
        if not str(question.get("question", "")).strip():
            raise RuntimeError(f"The AI generated an empty question at position {index}.")
        if not str(question.get("skill_tag", "")).strip():
            raise RuntimeError(f"Question {index} is missing a skill tag.")
        if not str(question.get("explanation", "")).strip():
            raise RuntimeError(f"Question {index} is missing a teacher explanation.")
        if len(str(question.get("explanation", "")).strip()) < 18:
            raise RuntimeError(f"Question {index} explanation is too short to be pedagogically useful.")

        question_type = question.get("type", "")
        if question_type == "multiple_choice" and len([x for x in question.get("options", []) if str(x).strip()]) != 4:
            raise RuntimeError(f"Question {index} does not contain 4 multiple-choice options.")
        if question_type == "true_false" and len([x for x in question.get("options", []) if str(x).strip()]) != 2:
            raise RuntimeError(f"Question {index} does not contain 2 true/false options.")
        if question_type == "matching" and len(question.get("pairs", [])) < 4:
            raise RuntimeError(f"Question {index} does not contain 4 matching pairs.")


def build_fallback_questions(
    *,
    topic: str,
    question_count: int,
    difficulty: str,
    test_type: str,
    language: str,
    key_concepts: list[str],
) -> list[dict[str, Any]]:
    """Build a deterministic local fallback set when the API is unavailable."""
    pack = LANGUAGE_PACK[language]
    concepts = key_concepts[:] or [f"{topic} concept {index + 1}" for index in range(max(4, question_count))]
    questions: list[dict[str, Any]] = []

    for index in range(question_count):
        concept = concepts[index % len(concepts)]
        skill_tag = concept if concept else f"{pack['skill_prefix']} {index + 1}"
        explanation = (
            f"{pack['explanation_prefix']} {topic} and focuses on {skill_tag.lower()}."
            if language != "kazakh"
            else f"{pack['explanation_prefix']} {topic} тақырыбының негізгі идеясын және {skill_tag.lower()} бағытын көрсетеді."
        )
        if test_type == "multiple_choice":
            correct = f"{concept} is the best-supported idea in {topic}."
            distractors = [
                f"{concept} is unrelated to {topic}.",
                f"{topic} has no connection to {concept}.",
                f"{concept} should always be ignored in {topic}.",
            ]
            questions.append(
                {
                    "type": test_type,
                    "question": pack["mc_question"].format(topic=topic),
                    "options": [correct] + distractors,
                    "correct_answer": correct,
                    "explanation": explanation,
                    "skill_tag": skill_tag,
                    "pairs": [],
                }
            )
        elif test_type == "true_false":
            options = TRUE_FALSE_OPTIONS[language]
            questions.append(
                {
                    "type": test_type,
                    "question": f"{pack['tf_question'].format(topic=topic)} ({skill_tag})",
                    "options": options,
                    "correct_answer": options[0],
                    "explanation": explanation,
                    "skill_tag": skill_tag,
                    "pairs": [],
                }
            )
        elif test_type == "short_answer":
            questions.append(
                {
                    "type": test_type,
                    "question": f"{pack['sa_question'].format(topic=topic)} ({skill_tag})",
                    "options": [],
                    "correct_answer": f"{topic}: {skill_tag}",
                    "explanation": explanation,
                    "skill_tag": skill_tag,
                    "pairs": [],
                }
            )
        else:
            pair_concepts = concepts[index:index + 4]
            while len(pair_concepts) < 4:
                pair_concepts.append(f"{topic} concept {len(pair_concepts) + 1}")
            questions.append(
                {
                    "type": "matching",
                    "question": pack["match_question"].format(topic=topic),
                    "options": [],
                    "correct_answer": "",
                    "explanation": explanation,
                    "skill_tag": skill_tag,
                    "pairs": [
                        {"left": pair_concepts[0], "right": f"Definition related to {topic} 1"},
                        {"left": pair_concepts[1], "right": f"Definition related to {topic} 2"},
                        {"left": pair_concepts[2], "right": f"Definition related to {topic} 3"},
                        {"left": pair_concepts[3], "right": f"Definition related to {topic} 4"},
                    ],
                }
            )

        questions[-1]["question"] = f"{questions[-1]['question']} [{difficulty.title()} {index + 1}]"

    return questions


def build_fallback_test(
    *,
    topic: str,
    question_count: int,
    difficulty: str,
    test_type: str,
    language: str,
    grade_level: str,
    learning_objective: str,
    lesson_stage: str,
    assessment_purpose: str,
    source_summary: str,
    key_concepts: list[str],
) -> dict[str, Any]:
    """Build a usable local fallback test when Groq is temporarily unavailable."""
    pack = LANGUAGE_PACK[language]
    questions = build_fallback_questions(
        topic=topic,
        question_count=question_count,
        difficulty=difficulty,
        test_type=test_type,
        language=language,
        key_concepts=key_concepts,
    )
    return {
        "title": f"{topic} {pack['title_suffix']}",
        "instructions": pack["instructions"],
        "topic": topic,
        "language": language,
        "test_type": test_type,
        "grade_level": grade_level,
        "learning_objective": learning_objective,
        "lesson_stage": lesson_stage,
        "assessment_purpose": assessment_purpose,
        "source_summary": source_summary,
        "key_concepts": key_concepts,
        "questions": questions,
        "fallback_mode": True,
    }


def create_test_with_strict_schema(
    client: OpenAI,
    *,
    topic: str,
    question_count: int,
    difficulty: str,
    test_type: str,
    language: str,
    grade_level: str,
    learning_objective: str,
    lesson_stage: str,
    assessment_purpose: str,
    source_material: str,
    source_name: str,
    source_summary: str,
    key_concepts: list[str],
) -> dict[str, Any]:
    """Generate a test using Groq structured outputs with strict schema."""
    response = client.chat.completions.create(
        model=DEFAULT_MODEL,
        temperature=0.3,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert teacher assistant. "
                    "Return clean JSON only and follow the schema exactly."
                ),
            },
            {
                "role": "user",
                "content": build_prompt(
                    topic=topic,
                    question_count=question_count,
                    difficulty=difficulty,
                    test_type=test_type,
                    language=language,
                    grade_level=grade_level,
                    learning_objective=learning_objective,
                    lesson_stage=lesson_stage,
                    assessment_purpose=assessment_purpose,
                    source_material=source_material,
                    source_name=source_name,
                    source_summary=source_summary,
                    key_concepts=key_concepts,
                ),
            },
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "teacher_test_generation",
                "strict": True,
                "schema": build_response_schema(test_type),
            },
        },
    )
    return parse_response_content(response)


def create_test_with_json_fallback(
    client: OpenAI,
    *,
    topic: str,
    question_count: int,
    difficulty: str,
    test_type: str,
    language: str,
    grade_level: str,
    learning_objective: str,
    lesson_stage: str,
    assessment_purpose: str,
    source_material: str,
    source_name: str,
    source_summary: str,
    key_concepts: list[str],
) -> dict[str, Any]:
    """Generate a test using plain json_object mode as a fallback."""
    response = client.chat.completions.create(
        model=DEFAULT_MODEL,
        temperature=0.2,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert teacher assistant. "
                    "Return valid JSON only. Do not include markdown or commentary."
                ),
            },
            {
                "role": "user",
                "content": (
                    build_prompt(
                        topic=topic,
                        question_count=question_count,
                        difficulty=difficulty,
                        test_type=test_type,
                        language=language,
                        grade_level=grade_level,
                        learning_objective=learning_objective,
                        lesson_stage=lesson_stage,
                        assessment_purpose=assessment_purpose,
                        source_material=source_material,
                        source_name=source_name,
                        source_summary=source_summary,
                        key_concepts=key_concepts,
                    )
                    + "\n\nReturn only one JSON object with title, instructions, and questions."
                ),
            },
        ],
        response_format={"type": "json_object"},
    )
    return parse_response_content(response)


def generate_test(
    topic: str,
    question_count: int,
    difficulty: str,
    test_type: str,
    language: str,
    grade_level: str = "",
    learning_objective: str = "",
    lesson_stage: str = "",
    assessment_purpose: str = "",
    source_material: str = "",
    source_name: str = "",
) -> dict[str, Any]:
    """Generate a structured test using Groq."""
    if not topic.strip():
        raise ValueError("Topic cannot be empty.")

    client = get_client()
    source_context = prepare_source_context(client, source_material, language)
    last_error: Exception | None = None

    for _ in range(MAX_GENERATION_ATTEMPTS):
        try:
            try:
                payload = create_test_with_strict_schema(
                    client,
                    topic=topic,
                    question_count=question_count,
                    difficulty=difficulty,
                    test_type=test_type,
                    language=language,
                    grade_level=grade_level,
                    learning_objective=learning_objective,
                    lesson_stage=lesson_stage,
                    assessment_purpose=assessment_purpose,
                    source_material=source_material,
                    source_name=source_name,
                    source_summary=source_context["summary"],
                    key_concepts=source_context["key_concepts"],
                )
            except Exception as error:
                if not should_fallback_to_json_mode(error):
                    raise
                payload = create_test_with_json_fallback(
                    client,
                    topic=topic,
                    question_count=question_count,
                    difficulty=difficulty,
                    test_type=test_type,
                    language=language,
                    grade_level=grade_level,
                    learning_objective=learning_objective,
                    lesson_stage=lesson_stage,
                    assessment_purpose=assessment_purpose,
                    source_material=source_material,
                    source_name=source_name,
                    source_summary=source_context["summary"],
                    key_concepts=source_context["key_concepts"],
                )

            normalized = normalize_test_payload(
                payload=payload,
                topic=topic,
                question_count=question_count,
                test_type=test_type,
                language=language,
                grade_level=grade_level,
                learning_objective=learning_objective,
                lesson_stage=lesson_stage,
                assessment_purpose=assessment_purpose,
                source_summary=source_context["summary"],
                key_concepts=source_context["key_concepts"],
            )
            validate_normalized_test(normalized, question_count)
            return normalized
        except Exception as error:
            last_error = error

    if ENABLE_FALLBACK_GENERATOR:
        return build_fallback_test(
            topic=topic,
            question_count=question_count,
            difficulty=difficulty,
            test_type=test_type,
            language=language,
            grade_level=grade_level,
            learning_objective=learning_objective,
            lesson_stage=lesson_stage,
            assessment_purpose=assessment_purpose,
            source_summary=source_context["summary"],
            key_concepts=source_context["key_concepts"],
        )

    raise RuntimeError(f"Failed to generate test from Groq API: {last_error}") from last_error
