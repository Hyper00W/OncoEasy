import { AppError } from "../errors/app-error";
import { createLogger } from "../observability/logger";
import { isWhatsAppEnabled, sendWhatsAppText, sendWhatsAppTemplate } from "./whatsapp";
import { isSmsEnabled, sendSmsText } from "./sms";
import { isEmailEnabled, sendEmail } from "./email";

const logger = createLogger("integration.notification");

/**
 * Safe integration diagnostics: the channel, outcome category, and provider
 * error code only. Recipient identifiers, message bodies, templates, and
 * provider responses are never logged.
 */
function logNotificationOutcome(
  operation: "whatsapp_send" | "sms_send" | "email_send",
  outcome: "succeeded" | "failed" | "fallback",
  detail?: { code?: string; durationMs?: number }
): void {
  const fields: Record<string, unknown> = { operation, outcome };
  if (detail?.code) fields.providerErrorCategory = detail.code;
  if (typeof detail?.durationMs === "number") fields.durationMs = detail.durationMs;

  if (outcome === "failed") {
    logger.warn("integration_notification_failed", fields);
  } else {
    logger.debug("integration_notification_completed", fields);
  }
}

export type NotificationChannelResult = {
  channel: "whatsapp" | "sms" | "email";
  providerMessageId: string | null;
  status: string;
};

export type EmailNotificationContent = {
  /** Email recipient; required when the notification may use the email channel. */
  email?: string;
  /** Neutral transactional subject. Clinical details must never go here. */
  subject?: string;
  text?: string;
  html?: string;
};

export type TransactionalNotification = {
  to: string;
  text: string;
  /**
   * Opt-in flag marking this notification as appropriate for SMS fallback.
   * Only transactional notifications that already exist in the product
   * workflows should set this; nothing is auto-classified and WhatsApp
   * successes never trigger a duplicate SMS.
   */
  allowSmsFallback?: boolean;
  template?: {
    name: string;
    languageCode: string;
    parameters?: string[];
  };
};

const WHATSAPP_FALLBACK_CODES = new Set(["WHATSAPP_DISABLED", "WHATSAPP_UNREACHABLE", "WHATSAPP_SEND_FAILED"]);

/**
 * Sends a transactional notification over WhatsApp (primary channel) and,
 * only when the caller explicitly opted in and WhatsApp did not succeed,
 * falls back to a single SMS attempt. There is no retry loop: at most one
 * attempt per channel, ever.
 *
 * Failures propagate as safe AppErrors (constant messages, no secrets or
 * message bodies) so they surface through the existing error architecture
 * instead of being silently swallowed:
 * - no fallback possible: the original WhatsApp/SMS error is rethrown
 * - both channels fail: a constant NOTIFICATION_FAILED error is thrown
 */
export async function sendTransactionalNotification(input: TransactionalNotification): Promise<NotificationChannelResult> {
  if (isWhatsAppEnabled()) {
    const startedAt = Date.now();
    try {
      const send = input.template
        ? sendWhatsAppTemplate({ to: input.to, template: input.template })
        : sendWhatsAppText({ to: input.to, body: input.text });
      const result = await send;
      logNotificationOutcome("whatsapp_send", "succeeded", { durationMs: Date.now() - startedAt });
      return { channel: "whatsapp", ...result };
    } catch (error) {
      const fallbackPossible =
        error instanceof AppError &&
        WHATSAPP_FALLBACK_CODES.has(error.code) &&
        input.allowSmsFallback === true &&
        isSmsEnabled();

      logNotificationOutcome("whatsapp_send", fallbackPossible ? "fallback" : "failed", {
        code: error instanceof AppError ? error.code : undefined,
        durationMs: Date.now() - startedAt
      });

      if (!fallbackPossible) {
        // Includes non-transient errors (e.g. invalid recipient format):
        // they are surfaced immediately and are not fallback candidates.
        throw error;
      }
    }
  } else if (!(input.allowSmsFallback === true && isSmsEnabled())) {
    // WhatsApp is not configured and no fallback is possible: preserve the
    // established disabled-channel semantics.
    throw new AppError(503, "WHATSAPP_DISABLED", "WhatsApp notifications are not configured");
  }

  // Single SMS fallback attempt (opt-in only, one try, no retries).
  const smsStartedAt = Date.now();
  try {
    const result = await sendSmsText({ to: input.to, text: input.text });
    logNotificationOutcome("sms_send", "succeeded", { durationMs: Date.now() - smsStartedAt });
    return { channel: "sms", ...result };
  } catch (error) {
    // Both channels failed. Individual channel error details are safe but
    // are combined into one constant error to keep the failure surface stable.
    logNotificationOutcome("sms_send", "failed", {
      code: error instanceof AppError ? error.code : undefined,
      durationMs: Date.now() - smsStartedAt
    });
    throw new AppError(502, "NOTIFICATION_FAILED", "Notification could not be delivered on any channel");
  }
}

/**
 * Sends an email-only transactional notification. Emails are sent exactly
 * once and never trigger WhatsApp/SMS side effects. Failures propagate as
 * safe AppErrors and are never silently swallowed.
 */
export async function sendEmailNotification(input: EmailNotificationContent): Promise<NotificationChannelResult> {
  if (!input.email || !input.subject || input.text === undefined) {
    throw new AppError(400, "NOTIFICATION_CONTENT_INVALID", "Email notifications require recipient, subject, and text");
  }
  const emailStartedAt = Date.now();
  try {
    const result = await sendEmail({ to: input.email, subject: input.subject, text: input.text, html: input.html });
    logNotificationOutcome("email_send", "succeeded", { durationMs: Date.now() - emailStartedAt });
    return { channel: "email", ...result };
  } catch (error) {
    logNotificationOutcome("email_send", "failed", {
      code: error instanceof AppError ? error.code : undefined,
      durationMs: Date.now() - emailStartedAt
    });
    throw error;
  }
}

export type MultiChannelNotificationRequest = TransactionalNotification & EmailNotificationContent & {
  /** Explicit email inclusion; when true the email channel is attempted once. */
  allowEmail?: boolean;
};

export type MultiChannelNotificationResult = {
  delivered: Array<NotificationChannelResult>;
  failed: Array<{ channel: "whatsapp" | "sms" | "email"; code: string }>;
};

/**
 * Explicit multi-channel notification. Each requested channel is attempted
 * at most once; a WhatsApp attempt never duplicates over SMS (the existing
 * primary/fallback semantics), while email is independent and opt-in only.
 * Channel failures are reported in the structured result instead of being
 * silently swallowed; no loops, no automatic channel expansion.
 */
export async function sendMultiChannelNotification(
  input: MultiChannelNotificationRequest
): Promise<MultiChannelNotificationResult> {
  const delivered: Array<NotificationChannelResult> = [];
  const failed: Array<{ channel: "whatsapp" | "sms" | "email"; code: string }> = [];

  const whatsappRequested = input.to !== undefined;
  const smsFallbackRequested = whatsappRequested && input.allowSmsFallback === true && isSmsEnabled();

  if (whatsappRequested) {
    let whatsappSucceeded = false;
    let whatsappAttempted = false;
    try {
      const send = input.template
        ? sendWhatsAppTemplate({ to: input.to, template: input.template })
        : sendWhatsAppText({ to: input.to, body: input.text });
      const result = await send;
      delivered.push({ channel: "whatsapp", ...result });
      whatsappSucceeded = true;
    } catch (error) {
      if (error instanceof AppError) {
        // WhatsApp-disabled with SMS fallback configured keeps the single
        // fallback-chain semantics of sendTransactionalNotification.
        if (WHATSAPP_FALLBACK_CODES.has(error.code) && smsFallbackRequested) {
          whatsappAttempted = true;
        } else {
          failed.push({ channel: "whatsapp", code: error.code });
        }
      } else {
        throw error;
      }
    }

    if (!whatsappSucceeded && smsFallbackRequested) {
      try {
        const result = await sendSmsText({ to: input.to, text: input.text });
        delivered.push({ channel: "sms", ...result });
      } catch (error) {
        if (error instanceof AppError) {
          failed.push({ channel: "sms", code: error.code });
        } else {
          throw error;
        }
      }
    } else if (!whatsappSucceeded && !whatsappAttempted && !isWhatsAppEnabled()) {
      // Matches the established WHATSAPP_DISABLED behavior when no fallback
      // is configured and WhatsApp was requested but not configured.
      failed.push({ channel: "whatsapp", code: "WHATSAPP_DISABLED" });
    }
  }

  if (input.allowEmail === true && isEmailEnabled()) {
    try {
      const result = await sendEmailNotification({
        email: input.email,
        subject: input.subject,
        text: input.text,
        html: input.html
      });
      delivered.push(result);
    } catch (error) {
      if (error instanceof AppError) {
        failed.push({ channel: "email", code: error.code });
      } else {
        throw error;
      }
    }
  }

  return { delivered, failed };
}
