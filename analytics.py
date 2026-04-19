"""Student attempt grading and analytics helpers."""

from __future__ import annotations

from collections import Counter, defaultdict
from statistics import median
from typing import Any


def normalize_text(value: str) -> str:
    """Normalize text for lenient comparisons."""
    return " ".join(value.lower().split())


def score_short_answer(student_answer: str, expected_answer: str) -> float:
    """Return a lenient score for short-answer questions."""
    student = normalize_text(student_answer)
    expected = normalize_text(expected_answer)
    if not student or not expected:
        return 0.0
    if student == expected:
        return 1.0
    if student in expected or expected in student:
        return 0.8
    student_tokens = set(student.split())
    expected_tokens = set(expected.split())
    overlap = len(student_tokens & expected_tokens)
    if not expected_tokens:
        return 0.0
    return overlap / len(expected_tokens)


def score_matching_answer(student_answer: dict[str, str], pairs: list[dict[str, str]]) -> float:
    """Score a matching question by fraction of correctly matched pairs."""
    if not pairs:
        return 0.0
    correct = 0
    for pair in pairs:
        left = str(pair.get("left", "")).strip()
        right = str(pair.get("right", "")).strip()
        if student_answer.get(left, "") == right:
            correct += 1
    return correct / len(pairs)


def grade_attempt(test_data: dict[str, Any], responses: dict[str, Any]) -> dict[str, Any]:
    """Grade a student attempt and return analytics-friendly data."""
    results = []
    type_scores: dict[str, list[float]] = defaultdict(list)
    skill_totals: Counter[str] = Counter()
    skill_errors: Counter[str] = Counter()

    total_score = 0.0
    questions = test_data.get("questions", [])
    for index, question in enumerate(questions):
        key = f"question_{index}"
        question_type = question.get("type", "")
        correct_answer = question.get("correct_answer", "")
        skill_tag = question.get("skill_tag", "") or test_data.get("topic", "General")
        student_answer = responses.get(key, "")

        if question_type in {"multiple_choice", "true_false"}:
            score = 1.0 if student_answer == correct_answer else 0.0
        elif question_type == "short_answer":
            score = min(1.0, score_short_answer(str(student_answer), str(correct_answer)))
        elif question_type == "matching":
            score = score_matching_answer(student_answer, question.get("pairs", []))
        else:
            score = 0.0

        is_correct = score >= 0.999
        total_score += score
        type_scores[question_type].append(score)
        skill_totals[skill_tag] += 1
        if score < 0.999:
            skill_errors[skill_tag] += 1

        results.append(
            {
                "index": index + 1,
                "question": question.get("question", ""),
                "type": question_type,
                "skill_tag": skill_tag,
                "student_answer": student_answer,
                "correct_answer": correct_answer,
                "explanation": question.get("explanation", ""),
                "score": round(score, 2),
                "is_correct": is_correct,
            }
        )

    total_questions = max(1, len(questions))
    percentage = round((total_score / total_questions) * 100, 2)
    by_type = {
        question_type: round((sum(scores) / len(scores)) * 100, 2)
        for question_type, scores in type_scores.items()
        if scores
    }
    error_topics = {skill: count for skill, count in skill_errors.most_common()}

    return {
        "total_score": round(total_score, 2),
        "total_questions": len(questions),
        "percentage": percentage,
        "per_question": results,
        "by_type": by_type,
        "error_topics": error_topics,
        "skill_totals": dict(skill_totals),
    }


def classify_risk(percentage: float) -> str:
    """Classify a score band into a risk level."""
    if percentage < 50:
        return "Critical"
    if percentage < 65:
        return "High"
    if percentage < 80:
        return "Moderate"
    return "Low"


def _safe_average(values: list[float]) -> float:
    """Return an average or zero when the list is empty."""
    return round(sum(values) / len(values), 2) if values else 0.0


def aggregate_attempt_history(attempts: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate saved attempts into a detailed per-test dashboard."""
    if not attempts:
        return {
            "attempt_count": 0,
            "average_percentage": 0.0,
            "median_percentage": 0.0,
            "pass_rate": 0.0,
            "unique_students": 0,
            "by_type": {},
            "error_topics": {},
            "variant_performance": {},
            "question_insights": [],
            "skill_insights": [],
            "weak_topics_priority": [],
            "student_risks": [],
            "student_profiles": [],
            "timeline": [],
            "variant_comparison": [],
            "risk_alerts": [],
            "recommendations": [],
        }

    percentages = [float(item.get("percentage", 0.0)) for item in attempts]
    average_percentage = round(sum(percentages) / len(percentages), 2)
    median_percentage = round(float(median(percentages)), 2)
    pass_rate = round((sum(1 for value in percentages if value >= 60) / len(percentages)) * 100, 2)

    type_accumulator: dict[str, list[float]] = defaultdict(list)
    error_topics: Counter[str] = Counter()
    variant_accumulator: dict[str, list[float]] = defaultdict(list)
    student_accumulator: dict[str, list[float]] = defaultdict(list)
    student_attempt_counts: Counter[str] = Counter()
    question_accumulator: dict[str, dict[str, Any]] = {}
    skill_accumulator: dict[str, dict[str, Any]] = {}
    timeline_accumulator: dict[str, list[float]] = defaultdict(list)

    for attempt in attempts:
        details = attempt.get("details", {})
        student_name = attempt.get("student_name", "Unknown")
        variant_name = attempt.get("variant_name", "Unknown")
        attempt_score = float(attempt.get("percentage", 0.0))

        student_accumulator[student_name].append(attempt_score)
        student_attempt_counts[student_name] += 1
        variant_accumulator[variant_name].append(attempt_score)

        created_at = str(attempt.get("created_at", ""))
        timeline_key = created_at[:10] if len(created_at) >= 10 else created_at or "Unknown"
        timeline_accumulator[timeline_key].append(attempt_score)

        for question_type, value in details.get("by_type", {}).items():
            type_accumulator[question_type].append(float(value))
        for topic, count in details.get("error_topics", {}).items():
            error_topics[topic] += int(count)

        for item in details.get("per_question", []):
            question_key = f"{item.get('index', 0)}::{item.get('question', '')}"
            question_bucket = question_accumulator.setdefault(
                question_key,
                {
                    "index": item.get("index", 0),
                    "question": item.get("question", ""),
                    "skill_tag": item.get("skill_tag", ""),
                    "scores": [],
                },
            )
            question_bucket["scores"].append(float(item.get("score", 0.0)))

            skill_tag = item.get("skill_tag", "") or "General"
            skill_bucket = skill_accumulator.setdefault(
                skill_tag,
                {"skill_tag": skill_tag, "scores": [], "attempts": 0},
            )
            skill_bucket["scores"].append(float(item.get("score", 0.0)))
            skill_bucket["attempts"] += 1

    question_insights = []
    for item in question_accumulator.values():
        accuracy = round((sum(item["scores"]) / len(item["scores"])) * 100, 2) if item["scores"] else 0.0
        question_insights.append(
            {
                "Question #": item["index"],
                "Question": item["question"],
                "Skill": item["skill_tag"],
                "Accuracy %": accuracy,
                "Error Rate %": round(100 - accuracy, 2),
                "Risk": classify_risk(accuracy),
            }
        )
    question_insights.sort(key=lambda row: (row["Accuracy %"], row["Question #"]))

    skill_insights = []
    for item in skill_accumulator.values():
        accuracy = round((sum(item["scores"]) / len(item["scores"])) * 100, 2) if item["scores"] else 0.0
        skill_insights.append(
            {
                "Skill": item["skill_tag"],
                "Accuracy %": accuracy,
                "Attempts": item["attempts"],
                "Risk": classify_risk(accuracy),
            }
        )
    skill_insights.sort(key=lambda row: row["Accuracy %"])
    weak_topics_priority = skill_insights[:5]

    student_profiles = []
    for student_name, scores in student_accumulator.items():
        average_score = round(sum(scores) / len(scores), 2)
        student_profiles.append(
            {
                "Student": student_name,
                "Average %": average_score,
                "Best %": round(max(scores), 2),
                "Lowest %": round(min(scores), 2),
                "Attempts": student_attempt_counts[student_name],
                "Risk": classify_risk(average_score),
            }
        )
    student_profiles.sort(key=lambda row: row["Average %"])
    student_risks = student_profiles[:]

    variant_performance = {
        variant_name: _safe_average(values)
        for variant_name, values in variant_accumulator.items()
        if values
    }
    variant_comparison = [
        {"Variant": variant_name, "Average %": average_score, "Risk": classify_risk(average_score)}
        for variant_name, average_score in sorted(variant_performance.items())
    ]
    by_type = {
        question_type: _safe_average(values)
        for question_type, values in type_accumulator.items()
        if values
    }
    timeline = [
        {"Date": date_key, "Average %": _safe_average(scores), "Attempts": len(scores)}
        for date_key, scores in sorted(timeline_accumulator.items())
    ]

    risk_alerts: list[str] = []
    recommendations: list[str] = []
    if average_percentage < 65:
        risk_alerts.append("Overall mastery is below the safe threshold. The full test may be too difficult or the topic needs re-teaching.")
        recommendations.append("Review the topic before the next assessment and regenerate a lighter reinforcement version.")
    if pass_rate < 70:
        risk_alerts.append("Pass rate is low. A large share of students are not meeting the expected outcome.")
        recommendations.append("Use the student answer review to identify misconceptions and reteach those concepts.")
    if weak_topics_priority:
        risk_alerts.append(f"Highest-priority weak topic: {weak_topics_priority[0]['Skill']}.")
        recommendations.append("Prepare targeted remediation tasks for the lowest-performing skills first.")
    if question_insights and question_insights[0]["Accuracy %"] < 60:
        risk_alerts.append(f"Question {question_insights[0]['Question #']} is the hardest item and may need revision.")
        recommendations.append("Check the lowest-performing questions for ambiguity or excessive difficulty.")
    if len(variant_performance) > 1 and (max(variant_performance.values()) - min(variant_performance.values()) >= 15):
        risk_alerts.append("There is a large performance gap between variants.")
        recommendations.append("Review wording and fairness across variants A/B/C/D.")
    if len(attempts) < 3:
        risk_alerts.append("The evidence base is still small. More student attempts are needed before drawing strong conclusions.")

    return {
        "attempt_count": len(attempts),
        "average_percentage": average_percentage,
        "median_percentage": median_percentage,
        "pass_rate": pass_rate,
        "unique_students": len(student_accumulator),
        "by_type": by_type,
        "error_topics": dict(error_topics),
        "variant_performance": variant_performance,
        "variant_comparison": variant_comparison,
        "question_insights": question_insights,
        "skill_insights": skill_insights,
        "weak_topics_priority": weak_topics_priority,
        "student_risks": student_risks,
        "student_profiles": student_profiles,
        "timeline": timeline,
        "risk_alerts": risk_alerts,
        "recommendations": recommendations,
    }


def _answer_signature(detail_payload: dict[str, Any]) -> str:
    """Build a stable answer signature for suspicious-attempt analysis."""
    responses = detail_payload.get("responses", {})
    return str(detail_payload.get("attempt_meta", {}).get("answer_signature", "")) or str(
        hash(str(sorted(responses.items())))
    )


def build_gradebook_rows(
    attempts: list[dict[str, Any]],
    roster_rows: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Return a teacher-friendly electronic gradebook."""
    roster_rows = roster_rows or []
    roster_by_email = {
        str(item.get("email", "")).strip().lower(): item
        for item in roster_rows
        if str(item.get("email", "")).strip()
    }
    roster_by_name = {
        str(item.get("full_name", "")).strip().lower(): item
        for item in roster_rows
        if str(item.get("full_name", "")).strip()
    }

    by_student: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for attempt in attempts:
        by_student[str(attempt.get("student_name", "Unknown")).strip() or "Unknown"].append(attempt)

    gradebook_rows: list[dict[str, Any]] = []
    for student_name, student_attempts in by_student.items():
        percentages = [float(item.get("percentage", 0.0)) for item in student_attempts]
        latest_attempt = student_attempts[0]
        student_key = str(latest_attempt.get("student_key", "")).strip().lower()
        roster = roster_by_email.get(student_key) or roster_by_name.get(student_name.lower(), {})
        gradebook_rows.append(
            {
                "Student": student_name,
                "Email": student_key or roster.get("email", ""),
                "Group": roster.get("group_name", ""),
                "Grade": roster.get("grade_level", ""),
                "Attempts": len(student_attempts),
                "Latest %": round(percentages[0], 2),
                "Average %": round(sum(percentages) / len(percentages), 2),
                "Best %": round(max(percentages), 2),
                "Lowest %": round(min(percentages), 2),
                "Last Submitted": latest_attempt.get("created_at", ""),
                "Risk": classify_risk(sum(percentages) / len(percentages)),
            }
        )
    gradebook_rows.sort(key=lambda row: (row["Risk"], row["Average %"], row["Student"]))
    return gradebook_rows


def build_topic_progress_rows(attempts: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Aggregate topic and skill mastery overall and per student."""
    overall_scores: dict[str, list[float]] = defaultdict(list)
    by_student_scores: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))

    for attempt in attempts:
        student_name = str(attempt.get("student_name", "Unknown")).strip() or "Unknown"
        for item in attempt.get("details", {}).get("per_question", []):
            skill = str(item.get("skill_tag", "")).strip() or "General"
            score = float(item.get("score", 0.0))
            overall_scores[skill].append(score)
            by_student_scores[student_name][skill].append(score)

    overall_rows = [
        {
            "Topic / Skill": skill,
            "Average %": round((sum(scores) / len(scores)) * 100, 2),
            "Questions Seen": len(scores),
            "Risk": classify_risk((sum(scores) / len(scores)) * 100),
        }
        for skill, scores in overall_scores.items()
        if scores
    ]
    overall_rows.sort(key=lambda row: row["Average %"])

    student_rows: list[dict[str, Any]] = []
    for student_name, skill_map in by_student_scores.items():
        for skill, scores in skill_map.items():
            average_score = round((sum(scores) / len(scores)) * 100, 2)
            student_rows.append(
                {
                    "Student": student_name,
                    "Topic / Skill": skill,
                    "Average %": average_score,
                    "Questions Seen": len(scores),
                    "Risk": classify_risk(average_score),
                }
            )
    student_rows.sort(key=lambda row: (row["Student"], row["Average %"]))
    return {"overall": overall_rows, "by_student": student_rows}


def detect_suspicious_attempts(attempts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flag suspicious attempts using simple, explainable heuristics."""
    signature_clusters: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    error_sequence_clusters: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    duration_clusters: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for attempt in attempts:
        details = attempt.get("details", {})
        signature = _answer_signature(details)
        cluster_key = (str(attempt.get("test_uid", "")), signature)
        signature_clusters[cluster_key].append(attempt)
        error_sequence = ",".join(
            str(item.get("index", 0))
            for item in details.get("per_question", [])
            if float(item.get("score", 0.0)) < 0.999
        )
        error_sequence_clusters[(str(attempt.get("test_uid", "")), error_sequence)].append(attempt)
        duration_seconds = int(details.get("attempt_meta", {}).get("duration_seconds", 0) or 0)
        if duration_seconds:
            duration_clusters[(str(attempt.get("test_uid", "")), duration_seconds)].append(attempt)

    flagged_rows: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for attempt in attempts:
        attempt_id = int(attempt.get("id", 0) or 0)
        if attempt_id in seen_ids:
            continue

        details = attempt.get("details", {})
        meta = details.get("attempt_meta", {})
        reasons: list[str] = []
        suspicion_score = 0
        duration_seconds = int(meta.get("duration_seconds", 0) or 0)
        percentage = float(attempt.get("percentage", 0.0))
        total_questions = max(1, int(details.get("total_questions", 0) or len(details.get("per_question", [])) or 1))
        signature = _answer_signature(details)
        signature_key = (str(attempt.get("test_uid", "")), signature)
        matching_cluster = signature_clusters.get(signature_key, [])
        error_sequence = ",".join(
            str(item.get("index", 0))
            for item in details.get("per_question", [])
            if float(item.get("score", 0.0)) < 0.999
        )
        matching_error_sequence = error_sequence_clusters.get((str(attempt.get("test_uid", "")), error_sequence), [])
        matching_duration = duration_clusters.get((str(attempt.get("test_uid", "")), duration_seconds), [])

        if duration_seconds and percentage >= 90 and duration_seconds <= max(45, total_questions * 12):
            reasons.append(f"Very fast completion ({duration_seconds}s) with a high score.")
            suspicion_score += 45
        if len({str(item.get('student_name', '')) for item in matching_cluster}) >= 2:
            reasons.append(f"Identical answer pattern shared by {len(matching_cluster)} attempts.")
            suspicion_score += 40
        if error_sequence and len({str(item.get('student_name', '')) for item in matching_error_sequence}) >= 2:
            reasons.append("The same sequence of mistakes appears across multiple students.")
            suspicion_score += 20
        if duration_seconds and len({str(item.get('student_name', '')) for item in matching_duration}) >= 2 and percentage >= 80:
            reasons.append("Multiple students finished in exactly the same time with strong results.")
            suspicion_score += 15
        if percentage == 100 and duration_seconds and duration_seconds <= max(30, total_questions * 8):
            reasons.append("Perfect score in unusually short time.")
            suspicion_score += 25

        if not reasons:
            continue

        seen_ids.add(attempt_id)
        flagged_rows.append(
            {
                "Attempt ID": attempt_id,
                "Student": attempt.get("student_name", ""),
                "Variant": attempt.get("variant_name", ""),
                "Score %": round(percentage, 2),
                "Duration (s)": duration_seconds,
                "Suspicion Score": min(100, suspicion_score),
                "Risk": "High" if suspicion_score >= 70 else "Moderate",
                "Reasons": " ".join(reasons),
                "Submitted At": attempt.get("created_at", ""),
            }
        )

    flagged_rows.sort(key=lambda row: (-row["Suspicion Score"], row["Student"]))
    return flagged_rows
