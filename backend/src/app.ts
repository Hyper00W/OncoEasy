import cors from "cors";
import express from "express";
import helmet from "helmet";

import { env } from "./config/env";
import { errorHandler } from "./middleware/error-handler";
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
import { adminReferralRouter, referralRouter } from "./modules/referrals/referral.routes";
import { adminConsultationRouter, consultationRouter } from "./modules/consultations/consultation.routes";
import { adminLabRouter, labRouter } from "./modules/labs/lab.routes";
import { adminPapRouter, papRouter } from "./modules/pap/pap.routes";
import { adminJourneyRouter, patientJourneyRouter } from "./modules/journey/journey.routes";
import { adminKnowledgeRouter, knowledgeRouter } from "./modules/knowledge/knowledge.routes";
import { adminTrialsRouter, trialsRouter } from "./modules/trials/trials.routes";
import { adminStoriesRouter, storiesRouter } from "./modules/stories/stories.routes";
import { adminChatRouter, chatRouter } from "./modules/chat/chat.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import { analyticsRouter } from "./modules/analytics/analytics.routes";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.list }));
// Webhooks need the raw body for signature verification, so they are mounted
// before the global JSON body parser.
app.use("/api/v1/payments/webhook", paymentWebhookRouter);
app.use(express.json());

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
app.use("/api/v1/chat", chatRouter);
app.use("/api/v1/admin/chat", adminChatRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/admin/analytics", analyticsRouter);

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok"
  });
});

app.use(errorHandler);

export default app;