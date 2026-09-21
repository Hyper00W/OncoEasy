import { randomBytes, randomUUID } from "node:crypto";

import { AppError } from "../errors/app-error";
import { env } from "../config/env";
import { S3PrivateStorage } from "./s3-private-storage";

export type PrivateStorageUpload = {
  key: string;
  contentType: string;
  body: Buffer;
};

export interface PrivateStorageProvider {
  upload(input: PrivateStorageUpload): Promise<{ key: string }>;
  delete(key: string): Promise<void>;
  createTemporaryAccess?(key: string, expiresInSeconds: number): Promise<{
    reference: string;
    expiresAt: Date;
  }>;
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
  } catch (_error) {
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
  } catch (_error) {
    throw new AppError(
      502,
      "STORAGE_ACCESS_FAILED",
      "Secure prescription access failed"
    );
  }
}