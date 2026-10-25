// Display labels for values stored in English in the database. Stored values
// ("Variant A", "russian") stay unchanged; only what people read is localized.

const LANGUAGES: Record<string, string> = { russian: "Русский", kazakh: "Қазақша", english: "English" };

export function languageLabel(code: string | null | undefined): string {
  return LANGUAGES[String(code || "").toLowerCase()] || String(code || "");
}

export function variantLabel(name: string | null | undefined): string {
  return String(name || "").replace(/^Variant\b/, "Вариант");
}

function comparable(value: string | null | undefined): string {
  return String(value || "").toLocaleLowerCase("ru").replace(/[«»"'.,:;!?()-]/g, " ").replace(/\s+/g, " ").trim();
}

/** The topic is worth showing only when it adds something the title does not already say. */
export function distinctTopic(topic: string | null | undefined, title: string | null | undefined): string {
  const t = comparable(topic);
  if (!t) return "";
  const name = comparable(title);
  return name === t || name.includes(t) ? "" : String(topic).trim();
}

/** "Тема · 11 класс · Русский", skipping empty or repeated parts. */
export function testMeta(test: { topic?: string | null; title?: string | null; grade_level?: string | null; language?: string | null }): string {
  return [distinctTopic(test.topic, test.title), String(test.grade_level || "").trim(), languageLabel(test.language)]
    .filter(Boolean).join(" · ");
}

// Server errors stay in English for the API and logs; the student sees them in Russian.
const STUDENT_MESSAGES: Record<string, string> = {
  "Answers are still being saved. Please retry submission.": "Ответы ещё сохраняются. Повторите отправку через несколько секунд.",
  "Could not advance the question. Please retry.": "Не удалось перейти к следующему вопросу. Повторите попытку.",
  "Could not check your submission status.": "Не удалось проверить, отправлена ли работа. Обновите страницу.",
  "Could not load the next question.": "Не удалось загрузить следующий вопрос. Повторите попытку.",
  "Could not load your draft.": "Не удалось загрузить сохранённые ответы. Обновите страницу.",
  "Could not open the strict test. Please retry.": "Не удалось открыть тест. Повторите попытку.",
  "Could not start this test. Please retry.": "Не удалось начать тест. Повторите попытку.",
  "Could not verify class access.": "Не удалось проверить доступ к классу. Повторите попытку позже.",
  "Draft could not be saved. Please retry.": "Не удалось сохранить ответы. Повторите попытку.",
  "Invalid answers.": "Не удалось прочитать ответы. Обновите страницу и повторите.",
  "Open the test before saving answers.": "Обновите страницу теста и повторите.",
  "Open the test before submitting.": "Работа уже отправлена или тест ещё не открыт. Обновите страницу.",
  "Only student accounts can open a test.": "Тест могут открыть только ученики. Войдите под аккаунтом ученика.",
  "Sign in with a student account.": "Войдите под аккаунтом ученика.",
  "Sign in with the verified Google account enrolled in this class.": "Войдите через тот Google-аккаунт, который учитель добавил в класс.",
  "Submission failed. Your draft remains available; please retry.": "Не удалось отправить работу. Ответы сохранены — повторите отправку.",
  "Test access is temporarily unavailable. Please retry later.": "Доступ к тесту временно недоступен. Повторите попытку позже.",
  "Test service is temporarily unavailable. Please retry later.": "Сервис временно недоступен. Повторите попытку позже.",
  "The attempt window has ended; the last saved draft was kept.": "Время вышло. Сохранены последние ответы, которые успели дойти до сервера.",
  "The deadline for this test has passed.": "Срок сдачи этого теста уже прошёл.",
  "The test is not ready for students.": "Тест ещё не готов. Сообщите учителю.",
  "This account has already submitted this test.": "Вы уже отправили этот тест.",
  "This account is not allowed to open the test.": "Этому аккаунту тест недоступен. Проверьте, что вы вошли под своим аккаунтом, или сообщите учителю.",
  "This account is not enrolled in the selected class.": "Этого аккаунта нет в списке класса. Войдите через тот Google-аккаунт, который учитель добавил в класс, или сообщите учителю.",
  "This class test link is unavailable.": "Ссылка для класса сейчас недоступна. Сообщите учителю.",
  "This Google account does not match the class roster.": "Этот Google-аккаунт не совпадает с адресом в списке класса. Сообщите учителю.",
  "This question is no longer open; the last saved answer was kept.": "Время на этот вопрос вышло. Сохранён последний ответ.",
  "This question is not currently open.": "Этот вопрос сейчас недоступен.",
  "This test is not published.": "Тест сейчас закрыт.",
  "This test link is unavailable.": "Ссылка недоступна. Проверьте её или сообщите учителю.",
  "This test was already submitted.": "Работа уже отправлена.",
};

export function studentMessage(message: string | null | undefined): string {
  const text = String(message || "").trim();
  if (STUDENT_MESSAGES[text]) return STUDENT_MESSAGES[text];
  if (/^Request failed \(\d+\)$/.test(text) || /^(Failed to fetch|Load failed|NetworkError)/i.test(text)) {
    return "Нет связи с сервером. Проверьте интернет и повторите попытку.";
  }
  return text;
}
