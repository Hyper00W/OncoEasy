import { randomBytes, randomUUID } from "node:crypto";

import { AppError } from "../errors/app-error";
import { env } from "../config/env";
import { createLogger } from "../observability/logger";
import { S3PrivateStorage } from "./s3-private-storage";

const logger = createLogger("integration.storage");

export type PrivateStorageUpload = {
  key: string;
  contentType: string;
  body: Buffer;
};

export type PrivateStorageObject = {
  body: Buffer;
  contentType: string;
};

export interface PrivateStorageProvider {
  upload(input: PrivateStorageUpload): Promise<{ key: string }>;
  delete(key: string): Promise<void>;
  createTemporaryAccess?(key: string, expiresInSeconds: number): Promise<{
    reference: string;
    expiresAt: Date;
  }>;
  /**
   * Server-side read of a private object. Used only when the provider cannot
   * hand the browser a loadable temporary reference (in-memory development
   * storage). Production providers serve the browser a signed URL instead.
   */
  read?(key: string): Promise<PrivateStorageObject>;
}

class InMemoryPrivateStorage implements PrivateStorageProvider {
  private readonly objects = new Map<string, PrivateStorageUpload>();

  async upload(input: PrivateStorageUpload) {
    this.objects.set(input.key, input);
    return { key: input.key };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async createTemporaryAccess(key: string, expiresInSeconds: number) {
    if (!this.objects.has(key)) {
      throw new Error("Private object was not found");
    }

    return {
      reference: `private://${randomUUID()}-${randomBytes(16).toString("hex")}`,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000)
    };
  }

  async read(key: string): Promise<PrivateStorageObject> {
    const object = this.objects.get(key);
    if (!object) {
      throw new AppError(404, "STORAGE_OBJECT_NOT_FOUND", "Private object was not found");
    }

    return { body: object.body, contentType: object.contentType };
  }
}

let provider: PrivateStorageProvider = createConfiguredProvider();

function createConfiguredProvider(): PrivateStorageProvider {
  if (env.STORAGE_PROVIDER === "s3" || env.STORAGE_PROVIDER === "s3-compatible") {
    // Configuration completeness is validated in config/env.ts.
    return new S3PrivateStorage({
      bucket: env.STORAGE_BUCKET as string,
      region: env.STORAGE_REGION as string,
      accessKeyId: env.STORAGE_ACCESS_KEY_ID as string,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY as string,
      ...(env.STORAGE_ENDPOINT ? { endpoint: env.STORAGE_ENDPOINT } : {}),
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE
    });
  }

  return new InMemoryPrivateStorage();
}

export function setPrivateStorageProvider(nextProvider: PrivateStorageProvider) {
  provider = nextProvider;
}

export function resetPrivateStorageProvider() {
  provider = createConfiguredProvider();
}

export async function uploadPrivatePrescription(input: {
  extension: string;
  contentType: string;
  body: Buffer;
}) {
  return uploadPrivateFile("prescriptions", input);
}

export async function uploadPrivateFile(prefix: string, input: {
  extension: string;
  contentType: string;
  body: Buffer;
}) {
  const key = `${prefix}/${randomUUID()}-${randomBytes(16).toString("hex")}${input.extension}`;

  try {
    return await provider.upload({ key, contentType: input.contentType, body: input.body });
  } catch (error) {
    // Safe diagnostics: operation + content type category. Keys, credentials,
    // and object contents are never logged.
    logger.warn("integration_storage_failed", {
      operation: "upload",
      contentType: input.contentType,
      providerErrorCategory: error instanceof AppError ? error.code : "PROVIDER_ERROR"
    });
    throw new AppError(502, "STORAGE_UPLOAD_FAILED", "Prescription storage failed");
  }
}

export async function deletePrivateObject(key: string) {
  try {
    await provider.delete(key);
  } catch (_error) {
    // Cleanup is best effort because the database operation has already failed.
  }
}

export async function readPrivateObject(key: string): Promise<PrivateStorageObject> {
  if (!provider.read) {
    throw new AppError(
      503,
      "STORAGE_READ_UNAVAILABLE",
      "Private object access is unavailable"
    );
  }

  try {
    return await provider.read(key);
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.warn("integration_storage_failed", {
      operation: "read",
      providerErrorCategory: "PROVIDER_ERROR"
    });
    throw new AppError(502, "STORAGE_READ_FAILED", "Private object could not be read");
  }
}

/**
 * A temporary reference the browser can load directly (production signed URLs).
 * The in-memory development provider returns opaque `private://` identifiers,
 * which browsers cannot load — those are served through the backend instead.
 */
export function isBrowserLoadableReference(reference: string): boolean {
  return reference.startsWith("https://") || reference.startsWith("http://");
}

export async function createPrivateTemporaryAccess(
  key: string,
  expiresInSeconds: number = env.STORAGE_SIGNED_URL_EXPIRY_SECONDS
) {
  if (!provider.createTemporaryAccess) {
    throw new AppError(
      503,
      "STORAGE_ACCESS_UNAVAILABLE",
      "Secure prescription access is unavailable"
    );
  }

  try {
    return await provider.createTemporaryAccess(key, expiresInSeconds);
  } catch (error) {
    logger.warn("integration_storage_failed", {
      operation: "createTemporaryAccess",
      providerErrorCategory: error instanceof AppError ? error.code : "PROVIDER_ERROR"
    });
    throw new AppError(
      502,
      "STORAGE_ACCESS_FAILED",
      "Secure prescription access failed"
    );
  }
}