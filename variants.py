"""Helpers for building classroom-ready test variants."""

from __future__ import annotations

from copy import deepcopy
import random
from typing import Any


VARIANT_CONFIGS = {
    "Variant A": {"seed": 101, "difficulty": "easy", "label": "Easy"},
    "Variant B": {"seed": 202, "difficulty": "medium", "label": "Medium"},
    "Variant C": {"seed": 303, "difficulty": "hard", "label": "Hard"},
    "Variant D": {"seed": 404, "difficulty": "mixed", "label": "Mixed"},
}


def shuffle_choice_question(question: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    """Shuffle answer options while preserving the correct answer text."""
    updated = deepcopy(question)
    options = list(updated.get("options", []))
    answer = updated.get("correct_answer", "")
    rng.shuffle(options)
    updated["options"] = options
    if answer in options:
        updated["correct_answer"] = answer
    return updated


def shuffle_matching_question(question: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    """Shuffle matching pairs for a variant."""
    updated = deepcopy(question)
    pairs = list(updated.get("pairs", []))
    rng.shuffle(pairs)
    updated["pairs"] = pairs
    return updated


def reshape_questions(test_data: dict[str, Any], seed: int) -> dict[str, Any]:
    """Shuffle question order and answer order in a deterministic way."""
    rng = random.Random(seed)
    variant = deepcopy(test_data)
    questions = deepcopy(variant.get("questions", []))
    rng.shuffle(questions)

    updated_questions = []
    for question in questions:
        if question.get("type") in {"multiple_choice", "true_false"}:
            updated_questions.append(shuffle_choice_question(question, rng))
        elif question.get("type") == "matching":
            updated_questions.append(shuffle_matching_question(question, rng))
        else:
            updated_questions.append(question)

    variant["questions"] = updated_questions
    return variant


def annotate_variant(test_data: dict[str, Any], variant_name: str) -> dict[str, Any]:
    """Attach display metadata to a variant."""
    config = VARIANT_CONFIGS[variant_name]
    variant = reshape_questions(test_data, config["seed"])
    variant["variant_name"] = variant_name
    variant["variant_difficulty"] = config["difficulty"]
    variant["variant_label"] = config["label"]
    return variant


def build_mixed_variant(variant_pool: dict[str, dict[str, Any]], question_count: int) -> dict[str, Any]:
    """Build a mixed-difficulty variant from the easy, medium, and hard pools."""
    rng = random.Random(VARIANT_CONFIGS["Variant D"]["seed"])
    source_names = ["Variant A", "Variant B", "Variant C"]
    collected_questions: list[dict[str, Any]] = []

    for index in range(question_count):
        source_name = source_names[index % len(source_names)]
        source_questions = variant_pool[source_name].get("questions", [])
        if not source_questions:
            continue
        source_question = deepcopy(source_questions[index % len(source_questions)])
        source_question["difficulty_source"] = VARIANT_CONFIGS[source_name]["difficulty"]
        collected_questions.append(source_question)

    rng.shuffle(collected_questions)
    mixed_base = deepcopy(variant_pool["Variant B"])
    mixed_base["questions"] = collected_questions
    mixed_base["title"] = f"{mixed_base.get('title', 'Generated Test')} - Mixed Mastery"
    mixed_base["instructions"] = (
        mixed_base.get("instructions", "").strip()
        or "Answer the questions carefully. This version mixes easy, medium, and hard tasks."
    )
    mixed_base["mixed_balance"] = {
        "easy": sum(1 for question in collected_questions if question.get("difficulty_source") == "easy"),
        "medium": sum(1 for question in collected_questions if question.get("difficulty_source") == "medium"),
        "hard": sum(1 for question in collected_questions if question.get("difficulty_source") == "hard"),
    }
    return annotate_variant(mixed_base, "Variant D")


def build_all_variants(variant_sources: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Build the four classroom variants from generated difficulty sources."""
    variants = {
        "Variant A": annotate_variant(variant_sources["Variant A"], "Variant A"),
        "Variant B": annotate_variant(variant_sources["Variant B"], "Variant B"),
        "Variant C": annotate_variant(variant_sources["Variant C"], "Variant C"),
    }
    question_count = len(variants["Variant B"].get("questions", []))
    variants["Variant D"] = build_mixed_variant(variants, question_count)
    return variants
