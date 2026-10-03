import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { AppError } from "../errors/app-error";
import type { PrivateStorageObject, PrivateStorageProvider, PrivateStorageUpload } from "./private-storage";

export type S3PrivateStorageOptions = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle: boolean;
};

export class S3PrivateStorage implements PrivateStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3PrivateStorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey
      }
    });
  }

  async upload(input: PrivateStorageUpload): Promise<{ key: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.body.length
      })
    );
    return { key: input.key };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
    );
  }

  async read(key: string): Promise<PrivateStorageObject> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key
        })
      );
      const body = result.Body ? Buffer.from(await result.Body.transformToByteArray()) : Buffer.alloc(0);
      return { body, contentType: result.ContentType ?? "application/octet-stream" };
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey" || (error as { name?: string }).name === "NotFound") {
        throw new AppError(404, "STORAGE_OBJECT_NOT_FOUND", "Private object was not found");
      }
      throw error;
    }
  }

  async createTemporaryAccess(
    key: string,
    expiresInSeconds: number
  ): Promise<{ reference: string; expiresAt: Date }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });
    const reference = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds
    });
    return {
      reference,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000)
    };
  }
}
