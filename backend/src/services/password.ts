import argon2 from "argon2";

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return argon2.verify(hash, password);
}