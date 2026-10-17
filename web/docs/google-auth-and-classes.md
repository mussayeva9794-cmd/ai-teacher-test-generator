# Google sign-in and class rosters

This feature uses Supabase Auth for Google sign-in and keeps teacher roles administrator-assigned. Each class stores normalized student email invitations. On the student's first class-link request, the server requires a Google identity and binds the verified Supabase user id to the matching class entry. Subsequent test links can target that class.

## Safe rollout order

1. Keep the current deployment running while preparing the database change.
2. In the Supabase SQL Editor, review and apply `supabase_google_classes.sql` to the existing project. It is additive; it does not delete attempts or rewrite existing share links. Verify that the query completes successfully.
3. Configure Google OAuth in Google Cloud and Supabase using the values below. Keep the Google Client Secret only in Supabase Auth provider settings; never place it in Vercel or a `NEXT_PUBLIC_*` variable.
4. Deploy the application code that includes this migration's matching API/schema support.
5. Sign in with one test Google student, add that student's exact Google email to a test class, create a test link for the class, and check both an enrolled and an unenrolled account.

The application has a compatibility fallback for existing unscoped links if the database migration is not present, but class management remains unavailable until the migration is applied.

## Google Cloud setup

1. In Google Cloud Console, create/select a project and open Google Auth Platform.
2. Create a Web application OAuth client.
3. Add authorized JavaScript origins:
   - `https://ai-teacher-test-generator.vercel.app`
   - `http://localhost:3000` only for local development.
4. Add this authorized redirect URI (the Supabase callback, not the app URL):
   - `https://dcbcpobmmyucvtnfhwro.supabase.co/auth/v1/callback`
5. The app requests only `openid email profile` for sign-in. Do not add Drive, Gmail, or other Google API scopes.
6. For personal Gmail or a mixture of school/personal accounts, choose External audience. Internal is only suitable when the Cloud project belongs to the school's Google Workspace organization and all users are in that organization. A Workspace administrator may also need to allow the OAuth app.

The app requests only identity scopes. Google documents a special sign-in exception for this scope set; still set the OAuth app to In production for a whole-school release and complete any branding/verification that Google asks for. If other scopes are later added, review Google's verification requirements again.

## Supabase Auth setup

1. Open Authentication → Sign In / Providers → Google and enable the provider.
2. Paste the Google Client ID and Client Secret into the Google provider settings and save.
3. Open Authentication → URL Configuration:
   - Site URL: `https://ai-teacher-test-generator.vercel.app`
   - Additional Redirect URLs: exact `https://ai-teacher-test-generator.vercel.app/login`
   - For local development only: exact `http://localhost:3000/login`
4. Keep email confirmation enabled for password registrations and leave manual identity linking disabled unless the school has a reviewed need for it. Class-roster access independently requires the verified email on the Google identity, so password-only users or a different linked Google email cannot claim an invitation.

Google login redirects back to `/login`; the app keeps the intended test/dashboard destination in the current browser tab and returns the student there after profile role lookup. A student first opening a shared test may need to sign in once; later links reuse the Supabase session until they sign out or the session expires.

## Teacher workflow

1. Open **Классы**, create `7А` or `7Б`, and paste student Google emails (one per line, or separated by commas/semicolons).
2. Share a published test and choose the class. The server restricts opening, draft saving, and submission to active members.
3. Add or remove students on the class page. Removing a student immediately blocks later API requests for that class. Archiving a class blocks all its class-scoped links without deleting its history.

The individual-email link option remains for one-off tests. A blank individual list retains the prior behavior: any signed-in student can use that link, so choose a class when access must be restricted to a class roster.
