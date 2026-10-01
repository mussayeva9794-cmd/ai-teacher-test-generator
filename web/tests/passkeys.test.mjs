import test from "node:test";
import assert from "node:assert/strict";
import { deletePasskey, listPasskeys, passkeyDestination, registerPasskey, signInWithPasskey } from "../lib/passkeys.ts";

test("registers a passkey on the current account", async () => {
  const credential = { id: "credential-1" };
  const auth = { registerPasskey: async () => ({ data: credential, error: null }) };
  assert.equal(await registerPasskey(auth), credential);
});

test("registration failures do not look successful", async () => {
  const failure = new Error("Passkeys disabled");
  const auth = { registerPasskey: async () => ({ data: null, error: failure }) };
  await assert.rejects(registerPasskey(auth), failure);
});

test("passkey sign-in returns the authenticated session", async () => {
  const session = { access_token: "new-token" };
  const auth = { signInWithPasskey: async () => ({ data: { session }, error: null }) };
  assert.equal(await signInWithPasskey(auth), session);
});

test("passkey sign-in rejects a missing session", async () => {
  const auth = { signInWithPasskey: async () => ({ data: { session: null }, error: null }) };
  await assert.rejects(signInWithPasskey(auth), /session/i);
});

test("passkey sign-in sends students home and teachers to their dashboard", () => {
  assert.equal(passkeyDestination("student"), "/");
  assert.equal(passkeyDestination("teacher"), "/dashboard");
});

test("lists only passkeys belonging to the signed-in user", async () => {
  const passkeys = [{ id: "credential-1", friendly_name: "Mac" }];
  const auth = { passkey: { list: async () => ({ data: passkeys, error: null }) } };
  assert.equal(await listPasskeys(auth), passkeys);
});

test("deletes a selected passkey using the user-scoped API", async () => {
  let deletedId = "";
  const auth = { passkey: { delete: async ({ passkeyId }) => { deletedId = passkeyId; return { error: null }; } } };
  await deletePasskey(auth, "credential-1");
  assert.equal(deletedId, "credential-1");
});

test("passkey management surfaces Supabase errors", async () => {
  const failure = new Error("Session expired");
  const auth = { passkey: { list: async () => ({ data: null, error: failure }) } };
  await assert.rejects(listPasskeys(auth), failure);
});
