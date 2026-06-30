// src/services/minds.ts
const MINDS_CLIENT_LIB = '@animocabrands/minds-client-lib'; // hides path from TS

let clientPromise: Promise<any> | null = null;

export async function getClient(): Promise<any> {
  if (!clientPromise) {
    clientPromise = import(MINDS_CLIENT_LIB).then((mod) => {
      return mod.createMindsClient({
        builderApiKey: process.env.MINDS_BUILDER_API_KEY!,
      });
    });
  }
  return clientPromise;
}

export async function resolveMindId(email: string): Promise<string | null> {
  const client = await getClient();
  const minds = await client.listMinds();

  const found = (minds as any[]).find(
    (m: any) =>
      typeof m.email === 'string' &&
      m.email.toLowerCase() === email.toLowerCase()
  );
  return found?.mindId ?? null;
}

export async function ensureConversation(
  alias: string,
  mindId: string
): Promise<void> {
  const client = await getClient();
  await client.ensureConversation(alias, mindId);
}

export async function sendAndWaitReply(
  alias: string,
  mindId: string,
  messageText: string,
  timeoutMs = 180_000
): Promise<string> {
  const client = await getClient();
  await client.ensureConversation(alias, mindId);

  const before = (await client.getLatestHistoryFingerprint(alias)) ?? '';
  await client.sendMessage({ alias, messageText });

  const outcome = await client.waitForReply({
    alias,
    timeoutMs,
    afterFingerprint: before,
    sentMessageText: messageText,
  });

  if (outcome.timedOut || !outcome.reply?.messageText) {
    throw new Error(`Poly did not reply within ${timeoutMs / 1000} seconds.`);
  }
  return outcome.reply.messageText;
}

export async function sendMessage(
  alias: string,
  mindId: string,
  messageText: string
): Promise<void> {
  const client = await getClient();
  await client.ensureConversation(alias, mindId);
  await client.sendMessage({ alias, messageText });
}

export async function getHistory(
  alias: string,
  after?: string,
  limit = 50
): Promise<any[]> {
  const client = await getClient();
  return client.getHistory(alias, { limit, after });
}

export async function getLatestFingerprint(alias: string): Promise<string> {
  const client = await getClient();
  const fp = await client.getLatestHistoryFingerprint(alias);
  return fp ?? '';
}

export async function getArtifact(alias: string, artifactId: string): Promise<{ mimeType: string; body: string } | null> {
  const client = await getClient();
  try {
    const artifact = await (client as any).getArtifact(alias, artifactId);
    return { mimeType: artifact.mimeType || 'image/png', body: artifact.artifact || artifact.body };
  } catch (e) {
    console.error('getArtifact error:', e);
    return null;
  }
}