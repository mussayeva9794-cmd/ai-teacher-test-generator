// A class's results across the teacher's tests: one row per student, one
// column per test the class has taken, oldest first.

export type ProgressAttempt = { test_id: string; student_id: string; percentage: number | null; submitted_at: string };
export type ProgressTest = { id: string; title: string };
export type ProgressMember = { email: string; student_id: string | null };

export type ProgressRow = {
  email: string;
  // null: not taken; "pending": waiting for the teacher's check.
  cells: (number | "pending" | null)[];
  average: number | null;
  // Last graded score minus the first one, when there are at least two.
  trend: number | null;
};

export function classProgress(members: ProgressMember[], tests: ProgressTest[], attempts: ProgressAttempt[]) {
  const studentIds = new Set(members.flatMap((member) => member.student_id ? [member.student_id] : []));
  const mine = attempts.filter((attempt) => studentIds.has(attempt.student_id));
  // Tests in the order the class first wrote them; untaken tests are left out.
  const firstTaken = new Map<string, number>();
  for (const attempt of mine) {
    const at = Date.parse(attempt.submitted_at);
    if (!firstTaken.has(attempt.test_id) || at < firstTaken.get(attempt.test_id)!) firstTaken.set(attempt.test_id, at);
  }
  const columns = tests.filter((test) => firstTaken.has(test.id)).sort((a, b) => firstTaken.get(a.id)! - firstTaken.get(b.id)!);
  const byStudentTest = new Map(mine.map((attempt) => [`${attempt.student_id}:${attempt.test_id}`, attempt]));
  const rows: ProgressRow[] = members.map((member) => {
    const cells = columns.map((test) => {
      const attempt = member.student_id ? byStudentTest.get(`${member.student_id}:${test.id}`) : undefined;
      return !attempt ? null : attempt.percentage === null ? "pending" as const : attempt.percentage;
    });
    const graded = cells.filter((cell): cell is number => typeof cell === "number");
    return {
      email: member.email, cells,
      average: graded.length ? Math.round(graded.reduce((sum, value) => sum + value, 0) / graded.length) : null,
      trend: graded.length >= 2 ? Math.round(graded[graded.length - 1] - graded[0]) : null,
    };
  }).sort((a, b) => a.email.localeCompare(b.email));
  return { columns, rows };
}
