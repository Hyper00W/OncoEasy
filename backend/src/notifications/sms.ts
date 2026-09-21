import { env } from "../config/env";
import { AppError } from "../errors/app-error";
import { normalizePhone } from "../modules/auth/patient-otp";

import { GenericHttpSmsProvider } from "./generic-http-sms";

export type SmsTextMessage = {
  to: string;
  text: string;
};

export type SmsSendResult = {
  providerMessageId: string | null;
  status: string;
};

export interface SmsProvider {
  sendText(message: SmsTextMessage): Promise<SmsSendResult>;
}

/**
 * Deterministic development/test provider. It never contacts an SMS gateway
 * and records outgoing messages so tests can inspect payloads without
 * credentials.
 */
export class InMemorySmsProvider implements SmsProvider {
  readonly sentTextMessages: SmsTextMessage[] = [];
  private nextMessageNumber = 1;

  async sendText(message: SmsTextMessage): Promise<SmsSendResult> {
    this.sentTextMessages.push(message);
    return { providerMessageId: `mock-sms-${this.nextMessageNumber++}`, status: "accepted" };
  }

  clear(): void {
    this.sentTextMessages.length = 0;
    this.nextMessageNumber = 1;
  }
}

type SmsState = {
  enabled: boolean;
  provider: SmsProvider;
};

let state = createConfiguredState();

function createConfiguredState(): SmsState {
  if (!env.SMS_ENABLED) {
    return { enabled: false, provider: new InMemorySmsProvider() };
  }

  // Configuration completeness is validated in config/env.ts at startup.
  return {
    enabled: true,
    provider: new GenericHttpSmsProvider({
      baseUrl: env.SMS_API_BASE_URL as string,
      apiKey: env.SMS_API_KEY as string,
      senderId: env.SMS_SENDER_ID
    })
  };
}

export function setSmsState(nextState: SmsState): void {
  state = nextState;
}

export function resetSmsState(): void {
  state = createConfiguredState();
}

export function isSmsEnabled(): boolean {
  return state.enabled;
}

/**
 * Sends a transactional SMS text message. Recipients are normalized with the
 * same utility used for authentication phone numbers. When SMS is not enabled
 * the send fails with a clear error instead of silently dropping the message
 * or falling back to a mock.
 */
export async function sendSmsText(input: SmsTextMessage): Promise<SmsSendResult> {
  if (!state.enabled) {
    throw new AppError(503, "SMS_DISABLED", "SMS notifications are not configured");
  }

  return state.provider.sendText({
    to: normalizePhone(input.to),
    text: input.text
  });
}
