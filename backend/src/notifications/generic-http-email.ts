import { AppError } from "../errors/app-error";

const DEFAULT_TIMEOUT_MS = 10_000;

export type GenericHttpEmailOptions = {
  baseUrl: string;
  apiKey: string;
  fromAddress: string;
  fromName?: string | null;
  timeoutMs?: number;
};

/**
 * Vendor-neutral production email adapter over plain HTTPS.
 *
 * Wire convention (documented in docs/production-configuration.md so any
 * transactional vendor can be pointed at it):
 *   POST <baseUrl>              (any vendor path is part of the configured URL)
 *   Authorization: Bearer <apiKey>
 *   Content-Type: application/json
 *   {
 *     "from":    "\"<fromName>\" <<fromAddress>>" (address alone when no name),
 *     "to":      "<recipient>",
 *     "subject": "<subject>",
 *     "text":    "<text body>",
 *     "html":    "<optional html body>" (only when provided)
 *   }
 *
 * A 2xx response is success. A JSON body may carry a reference in
 * `messageId` | `message_id` | `id` and an optional string `status`.
 *
 * Single-attempt sends (no blind retries). Errors are converted into safe
 * application errors with constant messages so the API key, recipient
 * addresses, and message contents never leak into logs or API responses.
 */
export class GenericHttpEmailProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly from: string;
  private readonly timeoutMs: number;

  constructor(options: GenericHttpEmailOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.from = options.fromName
      ? `"${options.fromName.replace(/"/g, "'")}" <${options.fromAddress}>`
      : options.fromAddress;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async sendEmail(input: { to: string; subject: string; text: string; html?: string }): Promise<{
    providerMessageId: string | null;
    status: string;
  }> {
    const payload: Record<string, string> = {
      from: this.from,
      to: input.to,
      subject: input.subject,
      text: input.text
    };
    if (input.html !== undefined) {
      payload.html = input.html;
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
      // Vendor rejected the request; the response body is intentionally not
      // surfaced because it is provider-internal detail.
      throw new AppError(502, "EMAIL_SEND_FAILED", "Email message could not be sent");
    }

    if (!rawBody.trim()) {
      // Empty 2xx body (e.g. 204) is treated as accepted without a reference.
      return { providerMessageId: null, status: "accepted" };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch (_error) {
      throw new AppError(502, "EMAIL_SEND_FAILED", "Email message could not be sent");
    }

    return {
      providerMessageId: extractReference(parsed),
      status: typeof parsed.status === "string" ? parsed.status : "accepted"
    };
  }
}

function extractReference(parsed: Record<string, unknown>): string | null {
  for (const key of ["messageId", "message_id", "id"]) {
    const value = parsed[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function unreachableError(): AppError {
  return new AppError(502, "EMAIL_UNREACHABLE", "Email service is unreachable");
}
