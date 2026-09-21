import { env } from "../config/env";
import { AppError } from "../errors/app-error";
import { normalizePhone } from "../modules/auth/patient-otp";

import { MetaWhatsAppProvider } from "./meta-whatsapp";

export type WhatsAppTextMessage = {
  to: string;
  body: string;
};

export type WhatsAppTemplateMessage = {
  to: string;
  template: {
    name: string;
    languageCode: string;
    parameters?: string[];
  };
};

export type WhatsAppSendResult = {
  providerMessageId: string | null;
  status: string;
};

export interface WhatsAppProvider {
  sendText(message: WhatsAppTextMessage): Promise<WhatsAppSendResult>;
  sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult>;
}

/**
 * Deterministic development/test provider. It never contacts Meta and records
 * outgoing messages so tests can inspect payloads without credentials.
 */
export class InMemoryWhatsAppProvider implements WhatsAppProvider {
  readonly sentTextMessages: WhatsAppTextMessage[] = [];
  readonly sentTemplateMessages: WhatsAppTemplateMessage[] = [];
  private nextMessageNumber = 1;

  async sendText(message: WhatsAppTextMessage): Promise<WhatsAppSendResult> {
    this.sentTextMessages.push(message);
    return { providerMessageId: `mock-${this.nextMessageNumber++}`, status: "accepted" };
  }

  async sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    this.sentTemplateMessages.push(message);
    return { providerMessageId: `mock-${this.nextMessageNumber++}`, status: "accepted" };
  }

  clear(): void {
    this.sentTextMessages.length = 0;
    this.sentTemplateMessages.length = 0;
    this.nextMessageNumber = 1;
  }
}

type WhatsAppState = {
  enabled: boolean;
  provider: WhatsAppProvider;
};

let state = createConfiguredState();

function createConfiguredState(): WhatsAppState {
  if (!env.WHATSAPP_ENABLED) {
    return { enabled: false, provider: new InMemoryWhatsAppProvider() };
  }

  // Configuration completeness is validated in config/env.ts at startup.
  return {
    enabled: true,
    provider: new MetaWhatsAppProvider({
      baseUrl: env.WHATSAPP_API_BASE_URL as string,
      apiVersion: env.WHATSAPP_API_VERSION as string,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID as string,
      accessToken: env.WHATSAPP_ACCESS_TOKEN as string
    })
  };
}

export function setWhatsAppState(nextState: WhatsAppState): void {
  state = nextState;
}

export function resetWhatsAppState(): void {
  state = createConfiguredState();
}

export function isWhatsAppEnabled(): boolean {
  return state.enabled;
}

/**
 * Sends a transactional WhatsApp text message. Recipients are normalized with
 * the same utility used for authentication phone numbers. When WhatsApp is not
 * enabled the send fails with a clear error instead of silently dropping the
 * message or falling back to a mock.
 */
export async function sendWhatsAppText(input: WhatsAppTextMessage): Promise<WhatsAppSendResult> {
  if (!state.enabled) {
    throw new AppError(503, "WHATSAPP_DISABLED", "WhatsApp notifications are not configured");
  }

  return state.provider.sendText({
    to: normalizePhone(input.to),
    body: input.body
  });
}

/**
 * Sends an approved WhatsApp template message. Template names, languages, and
 * parameters must come from templates approved in the Meta Business Manager;
 * this service never fabricates template identities.
 */
export async function sendWhatsAppTemplate(input: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
  if (!state.enabled) {
    throw new AppError(503, "WHATSAPP_DISABLED", "WhatsApp notifications are not configured");
  }

  return state.provider.sendTemplate({
    to: normalizePhone(input.to),
    template: input.template
  });
}
