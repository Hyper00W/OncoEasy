import { env } from "../config/env";
import { AppError } from "../errors/app-error";

import { GenericHttpEmailProvider } from "./generic-http-email";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailSendResult = {
  providerMessageId: string | null;
  status: string;
};

export interface EmailProvider {
  sendEmail(message: EmailMessage): Promise<EmailSendResult>;
}

/**
 * Deterministic development/test provider. It never contacts an email vendor
 * and records outgoing messages so tests can inspect recipients, subjects,
 * bodies, HTML, send counts, and provider references without credentials.
 */
export class InMemoryEmailProvider implements EmailProvider {
  readonly sentEmails: Array<Required<Pick<EmailMessage, "to" | "subject" | "text">> & { html: string | null }> = [];
  private nextMessageNumber = 1;

  async sendEmail(message: EmailMessage): Promise<EmailSendResult> {
    this.sentEmails.push({ to: message.to, subject: message.subject, text: message.text, html: message.html ?? null });
    return { providerMessageId: `mock-email-${this.nextMessageNumber++}`, status: "accepted" };
  }

  clear(): void {
    this.sentEmails.length = 0;
    this.nextMessageNumber = 1;
  }
}

type EmailState = {
  enabled: boolean;
  provider: EmailProvider;
};

let state = createConfiguredState();

function createConfiguredState(): EmailState {
  if (!env.EMAIL_ENABLED) {
    return { enabled: false, provider: new InMemoryEmailProvider() };
  }

  // Configuration completeness is validated in config/env.ts at startup.
  return {
    enabled: true,
    provider: new GenericHttpEmailProvider({
      baseUrl: env.EMAIL_API_BASE_URL as string,
      apiKey: env.EMAIL_API_KEY as string,
      fromAddress: env.EMAIL_FROM_ADDRESS as string,
      fromName: env.EMAIL_FROM_NAME
    })
  };
}

export function setEmailState(nextState: EmailState): void {
  state = nextState;
}

export function resetEmailState(): void {
  state = createConfiguredState();
}

export function isEmailEnabled(): boolean {
  return state.enabled;
}

/**
 * Sends a transactional email. When email is not enabled the send fails with
 * a clear error instead of silently dropping the message or falling back to
 * a mock. Subjects should stay neutral for healthcare content; callers own
 * the wording and must not place clinical details in subjects.
 */
export async function sendEmail(input: EmailMessage): Promise<EmailSendResult> {
  if (!state.enabled) {
    throw new AppError(503, "EMAIL_DISABLED", "Email notifications are not configured");
  }

  const recipient = input.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new AppError(400, "INVALID_EMAIL", "Recipient email address is not valid");
  }

  return state.provider.sendEmail({ ...input, to: recipient });
}
