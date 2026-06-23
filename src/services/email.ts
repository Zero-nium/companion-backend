import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

const PROXY_DOMAIN = process.env.PROXY_DOMAIN || 'pals.yourdomain.com';

export async function sendEmailToAgent(
  agentEmail: string,
  fromEmail: string,
  subject: string,
  body: string,
  messageId: string,
  threadId?: string
) {
  await resend.emails.send({
    from: fromEmail,
    to: agentEmail,
    subject,
    html: body,
    headers: {
      'Message-ID': `<${messageId}@${PROXY_DOMAIN}>`,
      ...(threadId ? {
        'In-Reply-To': `<${threadId}@${PROXY_DOMAIN}>`,
        'References': `<${threadId}@${PROXY_DOMAIN}>`
      } : {})
    },
  });
}