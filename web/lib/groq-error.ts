export type GroqFailureReason =
  | "configuration"
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "request_rejected"
  | "upstream"
  | "invalid_response";

export class GroqGenerationError extends Error {
  readonly reason: GroqFailureReason;
  readonly upstreamStatus?: number;

  constructor(
    reason: GroqFailureReason,
    message: string,
    upstreamStatus?: number,
  ) {
    super(message);
    this.name = "GroqGenerationError";
    this.reason = reason;
    this.upstreamStatus = upstreamStatus;
  }
}

export function classifyGroqStatus(status: number): GroqFailureReason {
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limit";
  if (status >= 400 && status < 500) return "request_rejected";
  return "upstream";
}

export function publicGenerationError(reason: GroqFailureReason): { message: string; status: number } {
  const messages: Record<GroqFailureReason, string> = {
    configuration: "Сервис генерации не настроен. Сообщите администратору.",
    authentication: "Сервис генерации отклонил доступ. Сообщите администратору.",
    rate_limit: "Лимит запросов к сервису генерации исчерпан. Попробуйте позже.",
    timeout: "Сервис генерации не успел ответить. Попробуйте ещё раз.",
    request_rejected: "Сервис генерации отклонил запрос. Сообщите администратору.",
    upstream: "Сервис генерации сейчас недоступен. Попробуйте позже.",
    invalid_response: "Не удалось получить полный тест. Уменьшите число вопросов или добавьте исходный материал и попробуйте ещё раз.",
  };
  return { message: messages[reason], status: reason === "rate_limit" ? 429 : 503 };
}
