import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

const corsOriginsSchema = z
  .string()
  .min(1, "CORS_ORIGIN is required")
  .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean))
  .refine((origins) => origins.length > 0, "CORS_ORIGIN must list at least one origin")
  .refine(
    (origins) => origins.every((origin) => origin === "*" || z.string().url().safeParse(origin).success),
    "CORS_ORIGIN entries must be valid URLs (comma-separated for multiple origins)"
  )
  .refine(
    (origins) => !(isProduction && origins.includes("*")),
    "CORS_ORIGIN must not use the wildcard origin in production"
  );

const jwtSecretSchema = z
  .string()
  .min(1, "JWT secrets must not be empty")
  .refine(
    (value) => !(isProduction && value.length < 32),
    "JWT secrets must be at least 32 characters in production"
  );

const storageProviderSchema = z.enum(["s3", "s3-compatible", "in-memory"]);

const envSchema = z
  .object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  CORS_ORIGIN: isProduction
    ? corsOriginsSchema
    : corsOriginsSchema.default(["http://localhost:5173"]),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) =>
        value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must use a PostgreSQL connection URL"
    )
    .refine(
      (value) =>
        !(
          isProduction &&
          /:\/\/(?:[^@\s]*@)?(?:localhost|127\.0\.0\.1|::1|\[::1\])[:/]/.test(
            value
          )
        ),
      "DATABASE_URL must not point at localhost in production"
    ),
  JWT_ACCESS_SECRET: jwtSecretSchema,
  JWT_REFRESH_SECRET: jwtSecretSchema,
  JWT_ACCESS_EXPIRES_IN: z.string().min(1),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1),
  PRESCRIPTION_MAX_FILE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(50 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  DELIVERY_PROOF_MAX_FILE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(20 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  STORAGE_PROVIDER: storageProviderSchema.default("in-memory"),
  STORAGE_BUCKET: z.string().trim().min(1).optional(),
  STORAGE_REGION: z.string().trim().min(1).optional(),
  STORAGE_ENDPOINT: z
    .string()
    .url()
    .optional(),
  STORAGE_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
  STORAGE_SIGNED_URL_EXPIRY_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(3600)
    .default(300),
  STORAGE_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WHATSAPP_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WHATSAPP_API_BASE_URL: z.string().url().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().trim().min(1).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().trim().min(1).optional(),
  WHATSAPP_API_VERSION: z
    .string()
    .trim()
    .regex(/^v\d+(\.\d+)?$/, "WHATSAPP_API_VERSION must look like v21.0")
    .optional(),
  SMS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMS_API_BASE_URL: z.string().url().optional(),
  SMS_API_KEY: z.string().trim().min(1).optional(),
  SMS_SENDER_ID: z.string().trim().min(1).optional(),
  PAYMENT_GATEWAY_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  PAYMENT_GATEWAY_KEY_ID: z.string().trim().min(1).optional(),
  PAYMENT_GATEWAY_KEY_SECRET: z.string().trim().min(1).optional(),
  PAYMENT_GATEWAY_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
  EMAIL_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  EMAIL_API_BASE_URL: z.string().url().optional(),
  EMAIL_API_KEY: z.string().trim().min(1).optional(),
  EMAIL_FROM_ADDRESS: z
    .string()
    .trim()
    .email()
    .optional(),
  EMAIL_FROM_NAME: z.string().trim().min(1).optional()
})

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid backend environment configuration:");
  for (const issue of parsedEnv.error.issues) {
    console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  console.error("Fix the environment configuration and start the server again.");
  process.exit(1);
}

const parsedData = parsedEnv.data;

const storageIssues: string[] = [];
if (parsedData.STORAGE_PROVIDER === "in-memory") {
  if (isProduction) {
    storageIssues.push("STORAGE_PROVIDER=in-memory must not be used in production; configure s3 or s3-compatible storage");
  }
} else {
  for (const [name, value] of [
    ["STORAGE_BUCKET", parsedData.STORAGE_BUCKET],
    ["STORAGE_REGION", parsedData.STORAGE_REGION],
    ["STORAGE_ACCESS_KEY_ID", parsedData.STORAGE_ACCESS_KEY_ID],
    ["STORAGE_SECRET_ACCESS_KEY", parsedData.STORAGE_SECRET_ACCESS_KEY]
  ] as const) {
    if (!value) storageIssues.push(`${name} is required when STORAGE_PROVIDER is ${parsedData.STORAGE_PROVIDER}`);
  }
  if (parsedData.STORAGE_PROVIDER === "s3-compatible" && !parsedData.STORAGE_ENDPOINT) {
    // Non-AWS S3-compatible providers resolve to AWS endpoints without an explicit endpoint URL.
    storageIssues.push("STORAGE_ENDPOINT is required when STORAGE_PROVIDER is s3-compatible");
  }
}

const whatsappIssues: string[] = [];
if (parsedData.WHATSAPP_ENABLED) {
  for (const [name, value] of [
    ["WHATSAPP_API_BASE_URL", parsedData.WHATSAPP_API_BASE_URL],
    ["WHATSAPP_PHONE_NUMBER_ID", parsedData.WHATSAPP_PHONE_NUMBER_ID],
    ["WHATSAPP_ACCESS_TOKEN", parsedData.WHATSAPP_ACCESS_TOKEN],
    ["WHATSAPP_API_VERSION", parsedData.WHATSAPP_API_VERSION]
  ] as const) {
    if (!value) whatsappIssues.push(`${name} is required when WHATSAPP_ENABLED=true`);
  }
}

const smsIssues: string[] = [];
if (parsedData.SMS_ENABLED) {
  for (const [name, value] of [
    ["SMS_API_BASE_URL", parsedData.SMS_API_BASE_URL],
    ["SMS_API_KEY", parsedData.SMS_API_KEY]
  ] as const) {
    if (!value) smsIssues.push(`${name} is required when SMS_ENABLED=true`);
  }
}

const paymentIssues: string[] = [];
if (parsedData.PAYMENT_GATEWAY_ENABLED) {
  for (const [name, value] of [
    ["PAYMENT_GATEWAY_KEY_ID", parsedData.PAYMENT_GATEWAY_KEY_ID],
    ["PAYMENT_GATEWAY_KEY_SECRET", parsedData.PAYMENT_GATEWAY_KEY_SECRET]
  ] as const) {
    if (!value) paymentIssues.push(`${name} is required when PAYMENT_GATEWAY_ENABLED=true`);
  }
}

const emailIssues: string[] = [];
if (parsedData.EMAIL_ENABLED) {
  for (const [name, value] of [
    ["EMAIL_API_BASE_URL", parsedData.EMAIL_API_BASE_URL],
    ["EMAIL_API_KEY", parsedData.EMAIL_API_KEY],
    ["EMAIL_FROM_ADDRESS", parsedData.EMAIL_FROM_ADDRESS]
  ] as const) {
    if (!value) emailIssues.push(`${name} is required when EMAIL_ENABLED=true`);
  }
}

if (
  storageIssues.length > 0 ||
  whatsappIssues.length > 0 ||
  smsIssues.length > 0 ||
  paymentIssues.length > 0 ||
  emailIssues.length > 0
) {
  console.error("Invalid backend environment configuration:");
  for (const issue of [...storageIssues, ...whatsappIssues, ...smsIssues, ...paymentIssues, ...emailIssues]) {
    console.error(`  - ${issue}`);
  }
  console.error("Fix the environment configuration and start the server again.");
  process.exit(1);
}

export const env = {
  ...parsedData,
  CORS_ORIGIN: {
    raw: parsedData.CORS_ORIGIN,
    list: parsedData.CORS_ORIGIN
  }
};

export type Environment = z.infer<typeof envSchema>;