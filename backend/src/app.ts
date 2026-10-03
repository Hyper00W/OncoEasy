import cors from "cors";
import express from "express";
import helmet from "helmet";

import { env } from "./config/env";
import { errorHandler } from "./middleware/error-handler";
import { prisma } from "./database/prisma";
import {
  requestContextMiddleware,
  requestLoggingMiddleware
} from "./observability/request-middleware";
import { authRouter } from "./modules/auth/auth.routes";
import { patientRouter } from "./modules/patient/patient.routes";
import { catalogRouter } from "./modules/pharmacy/catalog/catalog.routes";
import { cartRouter } from "./modules/pharmacy/carts/cart.routes";
import { prescriptionRouter } from "./modules/pharmacy/prescriptions/prescription.routes";
import { orderRouter } from "./modules/pharmacy/orders/order.routes";
import { adminOrderRouter } from "./modules/pharmacy/orders/order.routes";
import { paymentRouter } from "./modules/pharmacy/payments/payment.routes";
import { paymentWebhookRouter } from "./modules/pharmacy/payments/payment.webhook";
import { deliveryRouter } from "./modules/pharmacy/delivery/delivery.routes";
import { productImportRouter } from "./modules/pharmacy/imports/product-import.routes";
import { adminDeliveryRouter, deliveryAgentRouter } from "./modules/pharmacy/delivery-agent/delivery-agent.routes";
import { forecastRouter } from "./modules/pharmacy/forecasts/forecast.routes";
import { adminReferralRouter, referralRouter } from "./modules/referrals/referral.routes";
import { adminConsultationRouter, consultationRouter } from "./modules/consultations/consultation.routes";
import { adminLabRouter, labRouter } from "./modules/labs/lab.routes";
import { adminPapRouter, papRouter } from "./modules/pap/pap.routes";
import { adminJourneyRouter, patientJourneyRouter } from "./modules/journey/journey.routes";
import { adminKnowledgeRouter, knowledgeRouter } from "./modules/knowledge/knowledge.routes";
import { adminTrialsRouter, trialsRouter } from "./modules/trials/trials.routes";
import { adminStoriesRouter, storiesRouter } from "./modules/stories/stories.routes";
import { adminTestimonialsRouter, testimonialsRouter } from "./modules/testimonials/testimonials.routes";
import { adminChatRouter, chatRouter } from "./modules/chat/chat.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import { analyticsRouter } from "./modules/analytics/analytics.routes";
import { auditRouter } from "./observability/audit.routes";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN.list,
    // The error contract carries a request correlation reference so browser
    // clients can display it for support (Phase 4.7 Step 11).
    exposedHeaders: ["X-Request-Id"]
  })
);
// Webhooks need the raw body for signature verification, so they are mounted
// before the global JSON body parser.
app.use("/api/v1/payments/webhook", paymentWebhookRouter);
app.use(express.json());

// Request correlation + lifecycle logging run at the boundary, before any
// routing, so every request (and every error) carries a request ID.
app.use(requestContextMiddleware);
app.use(requestLoggingMiddleware);

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/patient", patientRouter);
app.use("/api/v1/pharmacy", catalogRouter);
app.use("/api/v1/pharmacy/cart", cartRouter);
app.use("/api/v1/pharmacy/prescriptions", prescriptionRouter);
app.use("/api/v1/pharmacy/orders", orderRouter);
app.use("/api/v1/admin/pharmacy/orders", adminOrderRouter);
app.use("/api/v1/pharmacy/orders", paymentRouter);
app.use("/api/v1/pharmacy/orders", deliveryRouter);
app.use("/api/v1/pharmacy/imports/products", productImportRouter);
app.use("/api/v1/pharmacy/deliveries", deliveryAgentRouter);
app.use("/api/v1/admin/pharmacy/deliveries", adminDeliveryRouter);
app.use("/api/v1/admin/pharmacy/forecasts", forecastRouter);
app.use("/api/v1/referrals", referralRouter);
app.use("/api/v1/admin/referrals", adminReferralRouter);
app.use("/api/v1/consultations", consultationRouter);
app.use("/api/v1/admin/consultations", adminConsultationRouter);
app.use("/api/v1/labs", labRouter);
app.use("/api/v1/admin/labs", adminLabRouter);
app.use("/api/v1/pap", papRouter);
app.use("/api/v1/admin/pap", adminPapRouter);
app.use("/api/v1/patient/journey", patientJourneyRouter);
app.use("/api/v1/admin/journey", adminJourneyRouter);
app.use("/api/v1/knowledge", knowledgeRouter);
app.use("/api/v1/admin/knowledge", adminKnowledgeRouter);
app.use("/api/v1/trials", trialsRouter);
app.use("/api/v1/admin", adminTrialsRouter);
app.use("/api/v1/stories", storiesRouter);
app.use("/api/v1/admin/stories", adminStoriesRouter);
app.use("/api/v1/testimonials", testimonialsRouter);
app.use("/api/v1/admin/testimonials", adminTestimonialsRouter);
app.use("/api/v1/chat", chatRouter);
app.use("/api/v1/admin/chat", adminChatRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/admin/analytics", analyticsRouter);
app.use("/api/v1/admin/audit", auditRouter);

/**
 * Liveness: process is up and able to serve. Deliberately dependency-free so
 * orchestrators never restart a healthy process because a dependency blipped.
 */
app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok"
  });
});

/**
 * Readiness: distinguishes a live process from one that cannot reach its
 * database. Reports only safe categories — never URLs, credentials, or
 * infrastructure details. Uses a cheap connectivity probe (SELECT 1) with a
 * short timeout; it does not validate configuration contents or run expensive
 * dependency checks.
 */
app.get("/health/ready", (_request, response) => {
  const deadline = new Promise<"ok" | "unreachable">((resolve) => {
    const timer = setTimeout(() => resolve("unreachable"), 1500);
    timer.unref?.();
    prisma
      .$queryRaw`SELECT 1`
      .then(() => resolve("ok"))
      .catch(() => resolve("unreachable"))
      .finally(() => clearTimeout(timer));
  });

  void deadline.then((database) => {
    response.status(database === "ok" ? 200 : 503).json({
      status: database === "ok" ? "ok" : "unavailable",
      checks: { process: "ok", database }
    });
  });
});

app.use(errorHandler);

export default app;