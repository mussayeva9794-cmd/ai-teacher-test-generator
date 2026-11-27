/**
 * README for the AI: how to write a good school test. Sent with every
 * generation request (see lib/groq.ts). Edit the text to change how the AI
 * writes questions. Keep it short: every word is sent three times per test
 * and counts against Groq's per-minute token limit.
 */
export const QUESTION_GUIDE = `# How to write a good school test

## The answer must not be obvious
- A student who has not learned the topic must not be able to guess the answer from the wording.
- Every wrong option (distractor) is plausible: it is a real mistake students make, a confused related term,
  a wrong step in a calculation, a swapped cause and effect, or a true fact that does not answer this question.
- All options are the same kind of thing (all dates, all terms, all numbers in the same unit), about the same length,
  in the same grammar form. The correct option is never the longest, the most detailed or the only "scientific" one.
- Never: joke options, options from another topic, "all of the above", "none of the above",
  an option that repeats a word from the question while the others do not, two options that mean the same.
- Put the correct option in a different position from question to question.
- True/false statements: about half true and half false; a false statement changes one important detail
  (a number, a term, a cause), never adds a silly mistake. Avoid "always", "never" as giveaways.
- Matching and ordering: items are close enough that the student must know the topic to place them.

## Difficulty
- easy: one step, a key fact or definition, but still with plausible distractors.
- medium: understanding: explain, compare, choose the right example, read a short situation or table.
- hard: two or more steps, applying the idea in a new situation, a calculation, finding the cause, choosing between
  two almost-right answers. Hard questions are hard because of thinking, not because of rare facts or tricky wording.

## Quality
- Every question checks one clear idea from the topic and the grade's school curriculum; facts must be correct.
- The question is complete and clear on its own; no "which of the following is true" without context.
- No questions about trivia (exact page numbers, author birthdays) unless the objective asks for them.
- The explanation says why the correct answer is right and why the most tempting wrong option is wrong.

## Kazakh language (when Language is kazakh)
- Write in correct literary Kazakh as in Kazakhstan school textbooks, not a word-for-word translation from Russian.
- Use the Kazakh letters ә, ғ, қ, ң, ө, ұ, ү, һ, і correctly; never replace them with Russian letters.
- Use Kazakh school terms (for example "зат есім", "көбейту", "жасуша", "теңдеу"), not Russian words,
  unless the term has no Kazakh equivalent in textbooks.
- Kazakh word order: the verb at the end; questions end with "?" and use question words or the particles ма/ме/ба/бе/па/пе.
- All text, including options, explanation and instructions, is in Kazakh.`;
