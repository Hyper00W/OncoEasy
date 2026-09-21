import { AppError } from "../errors/app-error";

const DEFAULT_TIMEOUT_MS = 10_000;

export type GenericHttpSmsOptions = {
  baseUrl: string;
  apiKey: string;
  senderId?: string | null;
  timeoutMs?: number;
};

/**
 * Vendor-neutral production SMS adapter over plain HTTPS.
 *
 * Wire convention (documented in docs/production-configuration.md so any
 * gateway can be pointed at it):
 *   POST <baseUrl>              (any gateway path is part of the configured URL)
 *   Authorization: Bearer <apiKey>
 *   Content-Type: application/json
 *   { "to": "<e164>", "text": "<body>", "from": "<senderId>" (only if set) }
 *
 * A 2xx response is success. A JSON body may carry a reference in
 * `messageId` | `message_id` | `id` | `sid` and an optional string `status`.
 *
 * Single-attempt sends (no blind retries). Errors are converted into safe
 * application errors with constant messages so the API key, phone numbers,
 * and message bodies never leak into logs or API responses.
 */
export class GenericHttpSmsProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly senderId: string | null;
  private readonly timeoutMs: number;

  constructor(options: GenericHttpSmsOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.senderId = options.senderId ?? null;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async sendText(input: { to: string; text: string }): Promise<{ providerMessageId: string | null; status: string }> {
    const payload: Record<string, string> = {
      to: input.to,
      text: input.text
    };
    if (this.senderId) {
      payload.from = this.senderId;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
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
      // Gateway rejected the request; the response body is intentionally not
      // surfaced because it is provider-internal detail.
      throw new AppError(502, "SMS_SEND_FAILED", "SMS message could not be sent");
    }

    if (!rawBody.trim()) {
      // Empty 2xx body (e.g. 204) is treated as accepted without a reference.
      return { providerMessageId: null, status: "accepted" };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch (_error) {
      throw new AppError(502, "SMS_SEND_FAILED", "SMS message could not be sent");
    }

    return {
      providerMessageId: extractReference(parsed),
      status: typeof parsed.status === "string" ? parsed.status : "accepted"
    };
  }
}

function extractReference(parsed: Record<string, unknown>): string | null {
  for (const key of ["messageId", "message_id", "id", "sid"]) {
    const value = parsed[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function unreachableError(): AppError {
  return new AppError(502, "SMS_UNREACHABLE", "SMS service is unreachable");
}
