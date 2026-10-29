// How a student is shown to the teacher: the profile name (from Google or
// sign-up) with the email beneath it, so two students with the same name, or
// one with no name, can still be told apart.

export type StudentIdentity = { name: string; email: string | null };

/** A profile name that is only the email's local part says nothing new. */
export function studentIdentity(displayName: string | null | undefined, email: string | null | undefined): StudentIdentity {
  const cleanEmail = email?.trim() || null;
  const name = displayName?.trim() || "";
  const localPart = cleanEmail?.split("@")[0] || "";
  if (name && name.toLowerCase() !== localPart.toLowerCase()) return { name, email: cleanEmail };
  // No real name: the email becomes the name and is not repeated beneath it.
  return { name: cleanEmail || name || "Student", email: null };
}
