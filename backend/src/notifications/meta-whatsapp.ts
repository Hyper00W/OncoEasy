import { AppError } from "../errors/app-error";

const DEFAULT_TIMEOUT_MS = 10_000;

export type MetaWhatsAppOptions = {
  baseUrl: string;
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
  timeoutMs?: number;
};

export type MetaOutgoingMessage = Record<string, unknown>;

/**
 * Production WhatsApp provider backed by the Meta WhatsApp Business Cloud API
 * over plain HTTPS. Credentials and endpoints come exclusively from backend
 * environment configuration; nothing is hardcoded here.
 *
 * Single-attempt sends (no blind retries). Errors are converted into safe
 * application errors with constant messages so the access token, phone
 * numbers, and message bodies never leak into logs or API responses.
 */
export class MetaWhatsAppProvider {
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly timeoutMs: number;

  constructor(options: MetaWhatsAppOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiVersion = options.apiVersion;
    this.phoneNumberId = options.phoneNumberId;
    this.accessToken = options.accessToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async sendText(input: { to: string; body: string }): Promise<{ providerMessageId: string | null; status: string }> {
    return this.post({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "text",
      text: { body: input.body }
    });
  }

  async sendTemplate(input: {
    to: string;
    template: { name: string; languageCode: string; parameters?: string[] };
  }): Promise<{ providerMessageId: string | null; status: string }> {
    const parameters = input.template.parameters ?? [];
    const template: Record<string, unknown> = {
      name: input.template.name,
      language: { code: input.template.languageCode }
    };

    if (parameters.length > 0) {
      template.components = [
        {
          type: "body",
          parameters: parameters.map((text) => ({ type: "text", text }))
        }
      ];
    }

    return this.post({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "template",
      template
    });
  }

  private async post(payload: MetaOutgoingMessage): Promise<{ providerMessageId: string | null; status: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (_error) {
      // Network failure or timeout: mapped to a constant safe error.
      throw unreachableError();
    } finally {
      clearTimeout(timeout);
    }

    const rawBody = await response.text();

    if (!response.ok) {
      // Provider rejected the request; the response body is intentionally
      // not surfaced because it is provider-internal detail.
      throw new AppError(502, "WHATSAPP_SEND_FAILED", "WhatsApp message could not be sent");
    }

    let parsed: { messages?: Array<{ id?: string; message_status?: string }> };
    try {
      parsed = JSON.parse(rawBody) as { messages?: Array<{ id?: string; message_status?: string }> };
    } catch (_error) {
      throw new AppError(502, "WHATSAPP_SEND_FAILED", "WhatsApp message could not be sent");
    }

    return {
      providerMessageId: parsed.messages?.[0]?.id ?? null,
      status: parsed.messages?.[0]?.message_status ?? "accepted"
    };
  }
}

function unreachableError(): AppError {
  return new AppError(502, "WHATSAPP_UNREACHABLE", "WhatsApp service is unreachable");
}
