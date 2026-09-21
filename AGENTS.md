# OncoEasy Agent Guidance

## Phase 1.7.5 Pharmacy Catalog Read APIs

Public catalog endpoints are mounted under `/api/v1/pharmacy`:


The product response fields are `id`, `sku`, `name`, `description`, `category`, `unitLabel`, `price`, `currency`, `prescriptionRequired`, `coldChainRequired`, `temperatureMinC`, `temperatureMaxC`, `minimumQuantity`, `regularDeliveryEligible`, and `coldChainDeliveryEligible`. `category` contains only `id`, `name`, and `slug`. Decimal values are returned as strings to preserve monetary and temperature precision.

Product list query parameters are `page` (default `1`), `pageSize` (default `20`, maximum `100`), `search` (case-insensitive name or SKU search), `category` (category slug), `prescriptionRequired` (`true` or `false`), and `coldChainRequired` (`true` or `false`). Only active products and active categories are public.

Catalog browsing is intentionally unauthenticated for this phase. Catalog read APIs are read-only. Product writes, Excel import persistence, admin product management, prescriptions, orders, checkout, payments, delivery, pharmacist workflows, notifications, and WhatsApp/SMS remain deferred.

## Phase 1.7.6 Pharmacy Cart APIs

Patient cart routes are mounted under `/api/v1/pharmacy/cart`:


These routes require authentication and the `PATIENT` role. Patient ownership is always derived from the authenticated JWT `userId`; clients cannot provide a patient identifier. Product additions and updates require an active product and respect `minimumQuantity`. Adding an existing product increases its quantity, while the cart item stores database-derived price and product-name snapshots. Prices are returned as precision-safe strings.

Checkout-time price, prescription, delivery, cold-chain, payment, COD, order, and fulfillment validation remain intentionally deferred.

## Phase 1.7.7 Cart Validation + Pricing Foundation

Cart responses include a reusable validation result and summary. Validation compares current product existence, active state, price, name snapshot, and minimum quantity without blocking cart reads or silently updating snapshots. Stale prices are reported as `PRICE_CHANGED`; snapshot and current prices are both exposed.

## Phase 1.7.8 Prescription Upload Foundation

Patient prescription uploads are available at `POST /api/v1/pharmacy/prescriptions` using multipart field `file` and optional `notes`. The endpoint requires an authenticated `PATIENT`; ownership is derived from the JWT and no patient identifier is accepted from the client.

Supported files are PDF, JPEG, PNG, and WEBP with matching MIME type, extension, and binary signature. Files are size-limited by `PRESCRIPTION_MAX_FILE_SIZE_BYTES`, stored through a provider-agnostic private storage abstraction, and persisted by opaque storage key only. Prescription records start at `PENDING_REVIEW` with source `PATIENT_UPLOAD`; responses never expose document contents, storage credentials, or public URLs.

Patients can list and retrieve their own prescription metadata through `GET /api/v1/pharmacy/prescriptions` and `GET /api/v1/pharmacy/prescriptions/:prescriptionId`. Pharmacists can review pending uploads through `GET /api/v1/pharmacy/prescriptions/review-queue` and `GET /api/v1/pharmacy/prescriptions/review/:prescriptionId`, then use `PATCH /:prescriptionId/verify`, `PATCH /:prescriptionId/reject`, or `PATCH /:prescriptionId/query` with a required reason for the latter two. Valid transitions begin at `PENDING_REVIEW` and end at `VERIFIED`, `REJECTED`, or `QUERY`; repeated review attempts return a state conflict. Reviewer identity and timestamp are persisted, and review detail exposes only a short-lived private storage reference.

Pharmacist-created carts, doctor callbacks, expiry, reuse, orders, payments, notifications, delivery, and frontend pharmacy UI remain deferred.

## Phase 1.7.10 Pharmacy Orders Foundation

Patient order routes are mounted under `/api/v1/pharmacy/orders`:

- `POST /` creates an order from the authenticated patient's active cart.
- `GET /` lists the authenticated patient's orders.
- `GET /:orderId` retrieves one owned order.

Order creation revalidates current cart products and prices, requires a patient-owned `VERIFIED` prescription for carts containing prescription products, snapshots current product names/prices into `OrderItem`, calculates Decimal-safe totals, and converts the cart transactionally while preserving cart items. Non-prescription and verified-prescription orders start at `PENDING_PAYMENT`; no payment is performed. A unique cart association prevents duplicate orders from concurrent conversion attempts.

Payment, COD, delivery fees, pincode serviceability, cold-chain delivery, fulfillment, pharmacist-created carts, doctor callbacks, referrals, notifications, and frontend order UI remain deferred.

## Phase 1.7.11 Pharmacy Payments + COD Rules

Patient payment routes are mounted under `/api/v1/pharmacy/orders`:

- `POST /:orderId/payment` initiates a `PREPAID` or eligible `COD` payment.
- `GET /:orderId/payment` returns the patient's payment metadata.

Payment initiation requires an owned `PENDING_PAYMENT` order and derives the amount from `Order.totalAmount`. Prepaid initiation creates or reuses a `PENDING` payment using a provider-neutral pending-integration marker; it never marks an order paid. COD initiation also remains `PENDING` and is allowed only when the order has an active configured `DeliveryPincode` with `codEligible=true`.

Delivery pincode serviceability is intentionally unpopulated until the client supplies the real list. No payment provider, webhook, capture, refund, cash collection, delivery fee, cold-chain serviceability, notification, or fulfillment behavior is implemented in this phase.

## Phase 1.7.12 Pharmacy Delivery + Pincode Rules

Patient delivery routes are mounted under `/api/v1/pharmacy/orders`:

- `PATCH /:orderId/delivery-pincode` sets the patient's delivery pincode while the order is `PENDING_PAYMENT`.
- `POST /:orderId/delivery/validate` validates serviceability, calculates the configured delivery fee, updates the order total, and creates or updates the pending delivery record.

Delivery serviceability uses active `DeliveryPincode` configuration. Local delivery takes precedence over courier delivery; cold-chain items require `coldChainEligible=true`; COD remains governed by `codEligible`. Mixed regular and cold-chain orders remain one delivery/order.

Delivery fees and free-delivery thresholds come from active `DeliveryPolicy` rows for `REGULAR` or `COLD_CHAIN`; no production pincode or policy values are seeded. Missing configuration returns a structured error rather than inventing a fee. Delivery-agent workflows, courier integrations, tracking, proof, notifications, production pincode import, and frontend delivery UI remain deferred.

## Phase 1.7.13 Pharmacy Excel Product Import Persistence

Internal product import routes are mounted under `/api/v1/pharmacy/imports/products` and require `PHARMACIST` or `OPS_ADMIN`:

- `POST /` accepts multipart XLSX input, reuses the existing parser, persists valid rows by SKU, and reports invalid/failed rows.
- `GET /` lists paginated import jobs.
- `GET /:importJobId` returns job summary and row results.

Existing SKUs are updated without changing SKU identity; new SKUs are created. Invalid rows are never persisted, and valid rows continue processing independently. `ProductImportJob` and `ProductImportRow` provide synchronous audit/count tracking with `COMPLETED` or `COMPLETED_WITH_ERRORS` status. Automatic category creation, background workers, inventory, forecasting, exports, and frontend import UI remain deferred.

## Phase 1.7.14 Delivery-Agent Module

Local delivery-agent routes are mounted under `/api/v1/pharmacy/deliveries`:

- `POST /:deliveryId/assign` assigns a local delivery to an active `DELIVERY_AGENT`; only `PHARMACIST` and `OPS_ADMIN` may assign.
- `GET /assigned` and `GET /:deliveryId` expose only deliveries assigned to the authenticated agent.
- `PATCH /:deliveryId/out-for-delivery`, `PATCH /:deliveryId/delivered`, and `PATCH /:deliveryId/failed` implement guarded agent lifecycle transitions.
- `POST /:deliveryId/proofs` accepts private image proofs for delivery photos and COD payment evidence.

Delivery agents can access only assigned local deliveries. Delivered orders require a delivery photo; COD orders also require cash-over-bill or online-payment proof. Proofs are stored through the private storage abstraction and only metadata is returned. Courier integrations, tracking/maps/GPS, notifications, delivery-agent dashboards, analytics, forecasting, and frontend delivery UI remain deferred.
