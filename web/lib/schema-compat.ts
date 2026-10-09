type DatabaseError = { code?: string; message?: string } | null | undefined;

export function isMissingClassSchema(error: DatabaseError): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() || "";
  if (error.code === "42703") return message.includes("class_id");
  if (error.code === "42P01") return message.includes("web_classes") || message.includes("web_class_members");
  if (error.code === "PGRST204" || error.code === "PGRST205") {
    return message.includes("class_id") || message.includes("web_classes") || message.includes("web_class_members");
  }
  return false;
}
