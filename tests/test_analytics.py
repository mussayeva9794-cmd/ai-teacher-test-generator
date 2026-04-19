import unittest

from analytics import build_gradebook_rows, build_topic_progress_rows, detect_suspicious_attempts, grade_attempt


class AnalyticsTests(unittest.TestCase):
    def test_grade_attempt_and_topic_progress(self) -> None:
        test_data = {
            "topic": "Math",
            "questions": [
                {"question": "2+2", "type": "multiple_choice", "options": ["3", "4"], "correct_answer": "4", "skill_tag": "Addition"},
                {"question": "3+5", "type": "short_answer", "correct_answer": "8", "skill_tag": "Addition"},
            ],
        }
        result = grade_attempt(test_data, {"question_0": "4", "question_1": "8"})
        self.assertEqual(result["percentage"], 100.0)

        attempts = [
            {
                "id": 1,
                "student_name": "Aruzhan",
                "student_key": "aruzhan@example.com",
                "variant_name": "Variant A",
                "test_uid": "test-1",
                "percentage": 100.0,
                "created_at": "2026-04-19T10:00:00",
                "details": result,
            }
        ]
        gradebook = build_gradebook_rows(attempts, [])
        self.assertEqual(len(gradebook), 1)
        self.assertEqual(gradebook[0]["Student"], "Aruzhan")

        topic_rows = build_topic_progress_rows(attempts)
        self.assertTrue(topic_rows["overall"])
        self.assertEqual(topic_rows["overall"][0]["Topic / Skill"], "Addition")

    def test_suspicious_attempt_detection(self) -> None:
        details = {
            "per_question": [{"index": 1, "score": 0.0}, {"index": 2, "score": 1.0}],
            "attempt_meta": {"duration_seconds": 20, "answer_signature": "same"},
            "responses": {"question_0": "A"},
            "total_questions": 2,
        }
        attempts = [
            {
                "id": 1,
                "student_name": "Aruzhan",
                "variant_name": "Variant A",
                "test_uid": "test-1",
                "percentage": 100.0,
                "created_at": "2026-04-19T10:00:00",
                "details": details,
            },
            {
                "id": 2,
                "student_name": "Dias",
                "variant_name": "Variant A",
                "test_uid": "test-1",
                "percentage": 100.0,
                "created_at": "2026-04-19T10:01:00",
                "details": details,
            },
        ]
        suspicious = detect_suspicious_attempts(attempts)
        self.assertTrue(suspicious)
        self.assertGreaterEqual(suspicious[0]["Suspicion Score"], 40)


if __name__ == "__main__":
    unittest.main()
