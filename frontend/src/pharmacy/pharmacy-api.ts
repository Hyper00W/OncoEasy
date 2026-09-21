import { apiClient } from "../api/client";

export type Category = { id: string; name: string; slug: string };
export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: Category;
  unitLabel: string | null;
  price: string;
  currency: string;
  prescriptionRequired: boolean;
  coldChainRequired: boolean;
  temperatureMinC: string | null;
  temperatureMaxC: string | null;
  minimumQuantity: number;
  regularDeliveryEligible: boolean;
  coldChainDeliveryEligible: boolean;
};
export type CartItem = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: string;
  currentUnitPrice: string;
  unitLabel: string | null;
  prescriptionRequired: boolean;
  coldChainRequired: boolean;
  temperatureMinC: string | null;
  temperatureMaxC: string | null;
  minimumQuantity: number;
  regularDeliveryEligible: boolean;
  coldChainDeliveryEligible: boolean;
};
export type Cart = {
  id: string | null;
  status: string;
  currency: string | null;
  items: CartItem[];
  summary: { subtotal: string; itemCount: number; currency: string | null };
  validation: { valid: boolean; issues: Array<{ code: string; productId?: string; message: string }> };
};
export type Prescription = {
  id: string;
  source: string;
  status: string;
  documentName: string;
  mimeType: string;
  notes: string | null;
  createdAt: string;
  patientId?: string;
  reviewReason?: string | null;
};
export type Order = {
  id: string;
  status: string;
  originType: string;
  currency: string;
  subtotal: string;
  deliveryFee: string;
  totalAmount: string;
  deliveryPincode: string | null;
  prescription: { id: string } | null;
  items: Array<{ id: string; productId: string; quantity: number; unitPrice: string; name: string }>;
  createdAt: string;
  updatedAt: string;
};
export type PaymentCheckout = { provider: string; keyId: string; gatewayOrderId: string; amountMinor: number; currency: string; orderId: string };
export type Payment = { id: string; method: string; status: string; amount: string; currency: string; provider: string; createdAt: string; checkout?: PaymentCheckout };
export type Delivery = {
  id: string;
  mode: string;
  status: string;
  agentId: string | null;
  trackingNumber: string | null;
  courierName: string | null;
  assignedAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  order: { id: string; patientId: string; deliveryPincode: string | null; status: string; currency: string; totalAmount: string; items: Array<{ quantity: number; productNameSnapshot: string }> };
  proofs: Array<{ id: string; type: string; documentName: string; mimeType: string; createdAt: string }>;
};
export type ImportJob = {
  importJobId: string;
  status: string;
  fileName: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdProducts: number;
  updatedProducts: number;
  failedRows: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rows?: Array<{ id: string; rowNumber: number; sku: string | null; status: string; errorCode: string | null; errorMessage: string | null; action: string | null }>;
};

type Envelope<T> = { success: true; data: T };
const data = <T>(request: Promise<Envelope<T>>): Promise<T> => request.then((response) => response.data);

export function listCategories() { return data(apiClient.get<Envelope<Category[]>>("/api/v1/pharmacy/categories")); }
export function listProducts(query: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== "") params.set(key, String(value)); });
  return data(apiClient.get<Envelope<{ items: Product[]; pagination: { total: number; totalPages: number } }>>(`/api/v1/pharmacy/products?${params}`));
}
export function getCart() { return data(apiClient.get<Envelope<Cart>>("/api/v1/pharmacy/cart")); }
export function addCartItem(productId: string, quantity: number) { return data(apiClient.post<Envelope<Cart>>("/api/v1/pharmacy/cart/items", { productId, quantity })); }
export function updateCartItem(productId: string, quantity: number) { return data(apiClient.patch<Envelope<Cart>>(`/api/v1/pharmacy/cart/items/${productId}`, { quantity })); }
export function removeCartItem(productId: string) { return data(apiClient.delete<Envelope<Cart>>(`/api/v1/pharmacy/cart/items/${productId}`)); }
export function clearCart() { return data(apiClient.delete<Envelope<Cart>>("/api/v1/pharmacy/cart")); }
export function listPrescriptions() { return data(apiClient.get<Envelope<{ items: Prescription[] }>>("/api/v1/pharmacy/prescriptions?page=1&pageSize=100")); }
export function uploadPrescription(file: File, notes: string) { const form = new FormData(); form.append("file", file); if (notes.trim()) form.append("notes", notes.trim()); return data(apiClient.postForm<Envelope<Prescription>>("/api/v1/pharmacy/prescriptions", form)); }
export function createOrder(input?: string | { prescriptionId?: string; referralToken?: string }) {
  const body = typeof input === "string" ? { prescriptionId: input } : input;
  return data(apiClient.post<Envelope<Order>>("/api/v1/pharmacy/orders", body));
}
export function listOrders() { return data(apiClient.get<Envelope<Order[]>>("/api/v1/pharmacy/orders")); }
export function getOrder(orderId: string) { return data(apiClient.get<Envelope<Order>>(`/api/v1/pharmacy/orders/${orderId}`)); }
export function setDeliveryPincode(orderId: string, pincode: string) { return data(apiClient.patch<Envelope<{ orderId: string; deliveryPincode: string }>>(`/api/v1/pharmacy/orders/${orderId}/delivery-pincode`, { pincode })); }
export function validateDelivery(orderId: string) { return data(apiClient.post<Envelope<{ orderId: string; deliveryFee: string; totalAmount: string; deliveryMode: string; codAvailable: boolean; delivery: { id: string; status: string } }>>(`/api/v1/pharmacy/orders/${orderId}/delivery/validate`)); }
export function initiatePayment(orderId: string, method: "PREPAID" | "COD") { return data(apiClient.post<Envelope<Payment>>(`/api/v1/pharmacy/orders/${orderId}/payment`, { method })); }
export function verifyPayment(orderId: string, payload: { gatewayOrderId: string; gatewayPaymentId: string; gatewaySignature: string }) { return data(apiClient.post<Envelope<Payment>>(`/api/v1/pharmacy/orders/${orderId}/payment/verify`, payload)); }
export function listReviewQueue() { return data(apiClient.get<Envelope<{ items: Prescription[] }>>("/api/v1/pharmacy/prescriptions/review-queue?page=1&pageSize=100")); }
export function getReviewPrescription(id: string) { return data(apiClient.get<Envelope<Prescription & { documentAccess?: { reference: string; expiresAt: string } }>>(`/api/v1/pharmacy/prescriptions/review/${id}`)); }
export function reviewPrescription(id: string, action: "verify" | "reject" | "query", reason?: string) { return data(apiClient.patch<Envelope<Prescription>>(`/api/v1/pharmacy/prescriptions/${id}/${action}`, action === "verify" ? undefined : { reason })); }
export function importProducts(file: File) { const form = new FormData(); form.append("file", file); return data(apiClient.postForm<Envelope<ImportJob & { errors?: Array<{ rowNumber: number; message: string }> }>>("/api/v1/pharmacy/imports/products", form)); }
export function listImports() { return data(apiClient.get<Envelope<{ items: ImportJob[] }>>("/api/v1/pharmacy/imports/products?page=1&pageSize=100")); }
export function getImport(id: string) { return data(apiClient.get<Envelope<ImportJob>>(`/api/v1/pharmacy/imports/products/${id}`)); }
export function assignDelivery(deliveryId: string, agentId: string) { return data(apiClient.post<Envelope<Delivery>>(`/api/v1/pharmacy/deliveries/${deliveryId}/assign`, { agentId })); }
export function listAssignedDeliveries() { return data(apiClient.get<Envelope<Delivery[]>>("/api/v1/pharmacy/deliveries/assigned")); }
export function getAssignedDelivery(id: string) { return data(apiClient.get<Envelope<Delivery>>(`/api/v1/pharmacy/deliveries/${id}`)); }
export function transitionDelivery(id: string, action: "out-for-delivery" | "delivered", body?: unknown) { return data(apiClient.patch<Envelope<Delivery>>(`/api/v1/pharmacy/deliveries/${id}/${action}`, body)); }
export function failDelivery(id: string, reason: string) { return data(apiClient.patch<Envelope<Delivery>>(`/api/v1/pharmacy/deliveries/${id}/failed`, { reason })); }
export function uploadDeliveryProof(id: string, file: File, proofType: "DELIVERY_PHOTO" | "CASH_OVER_BILL" | "ONLINE_PAYMENT") { const form = new FormData(); form.append("file", file); form.append("proofType", proofType); return data(apiClient.postForm<Envelope<Delivery["proofs"][number]>>(`/api/v1/pharmacy/deliveries/${id}/proofs`, form)); }
export type AdminOrder = Order & { patient: { patientId: string; fullName: string }; payments: Array<{ method: string; status: string; amount: string; currency: string }>; delivery: { id: string; mode: string; status: string; agentId: string | null } | null };
type Paginated<T> = { items: T[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
function listQuery(params: Record<string, string | number | undefined>): string { const search = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== "") search.set(key, String(value)); }); return search.toString(); }
export function listAdminOrders(query: { page?: number; pageSize?: number; status?: string } = {}) { return data(apiClient.get<Envelope<Paginated<AdminOrder>>>(`/api/v1/admin/pharmacy/orders?${listQuery({ ...query })}`)); }
export function getAdminOrder(orderId: string) { return data(apiClient.get<Envelope<AdminOrder>>(`/api/v1/admin/pharmacy/orders/${orderId}`)); }
export function listAdminDeliveries(query: { page?: number; pageSize?: number; status?: string; mode?: string } = {}) { return data(apiClient.get<Envelope<Paginated<Delivery>>>(`/api/v1/admin/pharmacy/deliveries?${listQuery({ ...query })}`)); }
export function getAdminDelivery(deliveryId: string) { return data(apiClient.get<Envelope<Delivery>>(`/api/v1/admin/pharmacy/deliveries/${deliveryId}`)); }
