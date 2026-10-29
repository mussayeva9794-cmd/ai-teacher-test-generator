import { parseSettings } from "./assessment";

export type MyAttemptRow = { id: string; test_id: string; link_id: string; percentage: number | null; submitted_at: string };
export type MyTestRow = { id: string; title: string; topic: string | null; status: string };
export type MyLinkRow = { id: string; token: string; settings: unknown; is_active: boolean };

/** One submitted test as the student sees it in "My tests". */
export type MyAttempt = {
  id: string;
  title: string;
  topic: string | null;
  submitted_at: string;
  // "hidden": the teacher chose not to show scores; "pending": the teacher still has to check it.
  score: { state: "shown"; percentage: number } | { state: "pending" | "hidden" };
  // The test link again, where the teacher allowed it, shows the answers; null once the link is closed.
  href: string | null;
};

/**
 * Shapes a student's own attempts for display. A score is shown only where
 * the link the attempt came through reveals scores, as on the test page.
 */
export function myAttempts(attempts: MyAttemptRow[], tests: MyTestRow[], links: MyLinkRow[]): MyAttempt[] {
  const testById = new Map(tests.map((test) => [test.id, test]));
  const linkById = new Map(links.map((link) => [link.id, link]));
  return attempts.flatMap((attempt) => {
    const test = testById.get(attempt.test_id);
    if (!test) return [];
    const link = linkById.get(attempt.link_id);
    const reveal = link ? parseSettings(link.settings).reveal_score : false;
    const score: MyAttempt["score"] = !reveal ? { state: "hidden" }
      : attempt.percentage === null ? { state: "pending" } : { state: "shown", percentage: Number(attempt.percentage) };
    const open = Boolean(link?.is_active && test.status === "published");
    return [{
      id: attempt.id, title: test.title, topic: test.topic, submitted_at: attempt.submitted_at, score,
      href: open && link ? `/s/${encodeURIComponent(link.token)}` : null,
    }];
  });
}
