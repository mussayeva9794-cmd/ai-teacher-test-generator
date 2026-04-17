"""Quality checks for generated and edited tests."""

from __future__ import annotations

from typing import Any


def normalize_text(value: str) -> str:
    """Normalize text for duplicate detection."""
    return " ".join(value.lower().split())


def analyze_test_quality(test_data: dict[str, Any], expected_count: int | None = None) -> dict[str, Any]:
    """Return a quality report with strengths, warnings, and blocking issues."""
    warnings: list[str] = []
    blocking_issues: list[str] = []
    strengths: list[str] = []

    title = str(test_data.get("title", "")).strip()
    instructions = str(test_data.get("instructions", "")).strip()
    questions = test_data.get("questions", [])

    if not title:
        blocking_issues.append("Test title is empty.")
    else:
        strengths.append("The test has a title.")

    if instructions:
        strengths.append("The test includes student instructions.")
    else:
        warnings.append("Student instructions are empty.")

    if test_data.get("key_concepts"):
        strengths.append("The test keeps extracted key concepts from the source material.")
    if test_data.get("fallback_mode"):
        warnings.append("The test was generated in fallback mode because the AI service was unavailable.")

    if not isinstance(questions, list) or not questions:
        blocking_issues.append("The test does not contain any questions.")
        return build_report(strengths, warnings, blocking_issues, 0)

    if expected_count is not None and len(questions) != expected_count:
        warnings.append(
            f"The test contains {len(questions)} questions instead of the requested {expected_count}."
        )

    normalized_questions = [normalize_text(str(question.get("question", ""))) for question in questions]
    if len({text for text in normalized_questions if text}) != len([text for text in normalized_questions if text]):
        blocking_issues.append("Some questions are duplicates or almost identical.")
    else:
        strengths.append("No duplicate questions were detected.")

    for index, question in enumerate(questions, start=1):
        question_text = str(question.get("question", "")).strip()
        question_type = str(question.get("type", "")).strip()
        explanation = str(question.get("explanation", "")).strip()
        skill_tag = str(question.get("skill_tag", "")).strip()

        if not question_text:
            blocking_issues.append(f"Question {index} is empty.")
            continue
        if not explanation:
            warnings.append(f"Question {index} does not include a teacher explanation.")
        elif len(explanation) < 18:
            warnings.append(f"Question {index} explanation is too short to be very useful for teaching.")
        if not skill_tag:
            warnings.append(f"Question {index} does not include a skill tag for analytics.")

        if question_type == "multiple_choice":
            check_multiple_choice(index, question, warnings, blocking_issues)
        elif question_type == "true_false":
            check_true_false(index, question, warnings, blocking_issues)
        elif question_type == "short_answer":
            check_short_answer(index, question, warnings, blocking_issues)
        elif question_type == "matching":
            check_matching(index, question, warnings, blocking_issues)
        else:
            blocking_issues.append(f"Question {index} has an unsupported type: {question_type}.")

    if not blocking_issues:
        strengths.append("The test is export-ready.")

    if test_data.get("variant_difficulty") == "mixed":
        balance = test_data.get("mixed_balance", {})
        if not all(int(balance.get(level, 0)) > 0 for level in ("easy", "medium", "hard")):
            warnings.append("The mixed variant does not contain a balanced distribution of easy, medium, and hard items.")
        else:
            strengths.append("The mixed variant contains easy, medium, and hard items.")

    score = max(0, 100 - (len(blocking_issues) * 18) - (len(warnings) * 6))
    return build_report(strengths, warnings, blocking_issues, score)


def check_multiple_choice(
    index: int,
    question: dict[str, Any],
    warnings: list[str],
    blocking_issues: list[str],
) -> None:
    """Validate a multiple-choice question."""
    options = [str(option).strip() for option in question.get("options", [])]
    filled_options = [option for option in options if option]
    correct_answer = str(question.get("correct_answer", "")).strip()

    if len(filled_options) != 4:
        blocking_issues.append(f"Question {index} must contain exactly 4 answer options.")
    if len({normalize_text(option) for option in filled_options}) != len(filled_options):
        blocking_issues.append(f"Question {index} contains duplicate answer options.")
    if correct_answer not in filled_options:
        blocking_issues.append(f"Question {index} has no valid correct answer selected.")


def check_true_false(
    index: int,
    question: dict[str, Any],
    warnings: list[str],
    blocking_issues: list[str],
) -> None:
    """Validate a true/false question."""
    options = [str(option).strip() for option in question.get("options", [])]
    filled_options = [option for option in options if option]
    correct_answer = str(question.get("correct_answer", "")).strip()

    if len(filled_options) != 2:
        blocking_issues.append(f"Question {index} must contain exactly 2 options.")
    if len({normalize_text(option) for option in filled_options}) != len(filled_options):
        blocking_issues.append(f"Question {index} contains duplicate true/false options.")
    if correct_answer not in filled_options:
        blocking_issues.append(f"Question {index} has no valid correct answer selected.")

    normalized = {normalize_text(option) for option in filled_options}
    if normalized not in (
        {"true", "false"},
        {"верно", "неверно"},
        {"дұрыс", "қате"},
    ):
        warnings.append(f"Question {index} uses non-standard true/false labels.")


def check_short_answer(
    index: int,
    question: dict[str, Any],
    warnings: list[str],
    blocking_issues: list[str],
) -> None:
    """Validate a short-answer question."""
    correct_answer = str(question.get("correct_answer", "")).strip()
    if not correct_answer:
        blocking_issues.append(f"Question {index} does not include an expected short answer.")


def check_matching(
    index: int,
    question: dict[str, Any],
    warnings: list[str],
    blocking_issues: list[str],
) -> None:
    """Validate a matching question."""
    pairs = question.get("pairs", [])
    if not isinstance(pairs, list) or len(pairs) < 2:
        blocking_issues.append(f"Question {index} must contain at least 2 matching pairs.")
        return

    complete_pairs = [
        pair for pair in pairs if str(pair.get("left", "")).strip() and str(pair.get("right", "")).strip()
    ]
    if len(complete_pairs) != len(pairs):
        blocking_issues.append(f"Question {index} contains incomplete matching pairs.")

    left_values = [normalize_text(str(pair.get("left", "")).strip()) for pair in complete_pairs]
    right_values = [normalize_text(str(pair.get("right", "")).strip()) for pair in complete_pairs]
    if len(set(left_values)) != len(left_values) or len(set(right_values)) != len(right_values):
        warnings.append(f"Question {index} contains duplicate matching items.")


def build_report(
    strengths: list[str],
    warnings: list[str],
    blocking_issues: list[str],
    score: int,
) -> dict[str, Any]:
    """Build the final quality report."""
    return {
        "strengths": strengths,
        "warnings": warnings,
        "blocking_issues": blocking_issues,
        "score": score,
        "is_export_ready": not blocking_issues,
    }
