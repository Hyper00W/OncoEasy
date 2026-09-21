import { apiClient } from "../api/client";
import type { Product } from "../pharmacy/pharmacy-api";

type Envelope<T> = { success: true; data: T };
export const referralTokenStorageKey = "oncoeasy:referral-token:v1";

export type ReferralItem = {
  productId?: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: string;
  currency: string;
  unitLabel: string | null;
};

export type Referral = {
  referralId: string;
  status: "SENT" | "VIEWED" | "ORDERED" | "FULFILLED";
  doctor?: { doctorId?: string; fullName: string };
  patient?: { patientId: string; fullName: string };
  items: ReferralItem[];
  order: { id: string; status: string } | null;
  viewedAt: string | null;
  orderedAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type CreatedReferral = Referral & { accessToken: string };

const data = <T>(request: Promise<Envelope<T>>): Promise<T> =>
  request.then((response) => response.data);

export function createReferral(patientId: string, items: Array<{ productId: string; quantity: number }>) {
  return data(apiClient.post<Envelope<CreatedReferral>>("/api/v1/referrals", { patientId, items }));
}

export function listDoctorReferrals() {
  return data(apiClient.get<Envelope<Referral[]>>("/api/v1/referrals"));
}

export function getDoctorReferral(referralId: string) {
  return data(apiClient.get<Envelope<Referral>>(`/api/v1/referrals/${referralId}`));
}

export function getPatientReferral(accessToken: string) {
  return data(apiClient.get<Envelope<Referral>>(`/api/v1/referrals/access/${encodeURIComponent(accessToken)}`));
}

export function addPatientReferralToCart(accessToken: string) {
  return data(apiClient.post<Envelope<Referral>>(`/api/v1/referrals/access/${encodeURIComponent(accessToken)}/cart`));
}

export type { Product };
