import {
  createMindsClient,
  MindsClient,
} from '@animocabrands/minds-client-lib';

let client: MindsClient | null = null;

function getClient(): MindsClient {
  if (!client) {
    client = createMindsClient({
      builderApiKey: process.env.MINDS_BUILDER_API_KEY!,
    });
  }
  return client;
}

export async function resolveMindId(email: string): Promise<string | null> {
  const c = getClient();
  const minds = await c.listMinds();

  // use 'any' to safely access properties
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
  const c = getClient();
  await c.ensureConversation(alias, mindId);
}

export async function sendAndWaitReply(
  alias: string,
  mindId: string,
  messageText: string,
  timeoutMs = 180_000
): Promise<string> {
  const c = getClient();
  await c.ensureConversation(alias, mindId);

  const before = (await c.getLatestHistoryFingerprint(alias)) ?? '';
  await c.sendMessage({ alias, messageText });

  const outcome = await c.waitForReply({
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
  const c = getClient();
  await c.ensureConversation(alias, mindId);
  await c.sendMessage({ alias, messageText });
}

export async function getHistory(
  alias: string,
  after?: string,
  limit = 50
): Promise<any[]> {
  const c = getClient();
  return c.getHistory(alias, { limit, after });
}

export async function getLatestFingerprint(alias: string): Promise<string> {
  const c = getClient();
  const fp = await c.getLatestHistoryFingerprint(alias);
  return fp ?? '';
}