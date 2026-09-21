import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
import {
  addCartItem,
  assignDelivery,
  clearCart,
  createOrder,
  failDelivery,
  getAdminDelivery,
  getAdminOrder,
  getCart,
  getAssignedDelivery,
  getOrder,
  getReviewPrescription,
  importProducts,
  initiatePayment,
  listAdminDeliveries,
  listAdminOrders,
  listAssignedDeliveries,
  listCategories,
  listImports,
  listOrders,
  listPrescriptions,
  listProducts,
  listReviewQueue,
  removeCartItem,
  reviewPrescription,
  setDeliveryPincode,
  transitionDelivery,
  updateCartItem,
  uploadDeliveryProof,
  uploadPrescription,
  validateDelivery,
  verifyPayment,
  type AdminOrder,
  type Cart,
  type Category,
  type Delivery,
  type ImportJob,
  type Order,
  type PaymentCheckout,
  type Prescription,
  type Product
} from "../pharmacy/pharmacy-api";
import { referralTokenStorageKey } from "../referrals/referral-api";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

type Navigate = (path: string) => void;
type Tab = "catalog" | "cart" | "prescriptions" | "orders";

export function PharmacyPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  if (!user) return null;

  function leave(): void {
    signOut();
    navigate("/");
  }

  return (
    <main className="workspace-page pharmacy-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">OncoEasy pharmacy</p>
          <h1>{user.role === "PATIENT" ? "Medicines and care supplies" : user.role === "DELIVERY_AGENT" ? "Assigned deliveries" : "Pharmacy operations"}</h1>
          <p className="intro">Backend-validated catalog, orders, prescriptions, and delivery workflows.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>
      {user.role === "PATIENT" ? <PatientPharmacy /> : null}
      {user.role === "PHARMACIST" || user.role === "OPS_ADMIN" ? <StaffPharmacy role={user.role} /> : null}
      {user.role === "DELIVERY_AGENT" ? <AgentPharmacy /> : null}
    </main>
  );
}

function PatientPharmacy() {
  const [tab, setTab] = useState<Tab>(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    return requestedTab === "cart" || requestedTab === "orders" || requestedTab === "prescriptions" ? requestedTab : "catalog";
  });
  const [cart, setCart] = useState<Cart | null>(null);
  const [cartError, setCartError] = useState<string | null>(null);
  const [cartLoading, setCartLoading] = useState(false);

  function refreshCart(): void {
    setCartLoading(true);
    setCartError(null);
    getCart().then(setCart).catch(setError(setCartError)).finally(() => setCartLoading(false));
  }

  useEffect(() => {
    getCart().then(setCart).catch(setError(setCartError)).finally(() => setCartLoading(false));
  }, []);

  function changeCartItem(productId: string, quantity: number): void {
    setCartLoading(true);
    updateCartItem(productId, quantity).then(setCart).catch(setError(setCartError)).finally(() => setCartLoading(false));
  }

  function deleteCartItem(productId: string): void {
    setCartLoading(true);
    removeCartItem(productId).then(setCart).catch(setError(setCartError)).finally(() => setCartLoading(false));
  }

  return (
    <>
      <nav className="pharmacy-tabs" aria-label="Pharmacy sections">
        {(["catalog", "cart", "prescriptions", "orders"] as Tab[]).map((value) => (
          <button className={tab === value ? "tab-active" : ""} key={value} type="button" onClick={() => setTab(value)}>
            {value === "catalog" ? "Catalog" : value === "cart" ? `Cart${cart?.items.length ? ` (${cart.items.length})` : ""}` : value === "prescriptions" ? "Prescriptions" : "My orders"}
          </button>
        ))}
      </nav>
      {cartError ? <Alert>{cartError}</Alert> : null}
      {tab === "catalog" ? <Catalog onCartChange={refreshCart} /> : null}
      {tab === "cart" ? <CartPanel cart={cart} loading={cartLoading} error={cartError} onRefresh={refreshCart} onChange={changeCartItem} onRemove={deleteCartItem} onClear={() => { setCartLoading(true); clearCart().then(setCart).catch(setError(setCartError)).finally(() => setCartLoading(false)); }} onCheckout={() => setTab("orders")} /> : null}
      {tab === "prescriptions" ? <PatientPrescriptions /> : null}
      {tab === "orders" ? <PatientOrders cart={cart} onCartChange={refreshCart} /> : null}
    </>
  );
}

function Catalog({ onCartChange }: { onCartChange: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [rxOnly, setRxOnly] = useState(false);
  const [coldChainOnly, setColdChainOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function loadProducts(overrides: Partial<{ search: string; category: string; prescriptionRequired: boolean | undefined; coldChainRequired: boolean | undefined; page: number }> = {}): void {
    setLoading(true);
    setError(null);
    const nextPage = overrides.page ?? page;
    listProducts({
      search: overrides.search ?? search,
      category: overrides.category ?? category,
      prescriptionRequired: overrides.prescriptionRequired ?? (rxOnly ? true : undefined),
      coldChainRequired: overrides.coldChainRequired ?? (coldChainOnly ? true : undefined),
      page: nextPage,
      pageSize: 12
    })
      .then((response) => { setProducts(response.items); setPage(nextPage); setTotalPages(response.pagination.totalPages); })
      .catch(setErrorMessage(setError))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    listCategories().then(setCategories).catch(setErrorMessage(setError));
    listProducts({ page: 1, pageSize: 12 }).then((response) => { setProducts(response.items); setTotalPages(response.pagination.totalPages); }).catch(setErrorMessage(setError)).finally(() => setLoading(false));
  }, []);

  function add(product: Product, quantity: number): void {
    setNotice(null);
    addCartItem(product.id, quantity).then(() => { setNotice(`${product.name} added to your cart.`); onCartChange(); }).catch(setErrorMessage(setError));
  }

  return (
    <section>
      <div className="pharmacy-toolbar">
        <Input aria-label="Search products" placeholder="Search by product or SKU" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") loadProducts(); }} />
        <select className="input" aria-label="Category" value={category} onChange={(event) => { const value = event.target.value; setCategory(value); loadProducts({ category: value, page: 1 }); }}>
          <option value="">All categories</option>
          {categories.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}
        </select>
        <label className="filter-check"><input type="checkbox" checked={rxOnly} onChange={(event) => { const value = event.target.checked; setRxOnly(value); loadProducts({ prescriptionRequired: value ? true : undefined, page: 1 }); }} /> Prescription</label>
        <label className="filter-check"><input type="checkbox" checked={coldChainOnly} onChange={(event) => { const value = event.target.checked; setColdChainOnly(value); loadProducts({ coldChainRequired: value ? true : undefined, page: 1 }); }} /> Cold-chain</label>
        <Button type="button" onClick={() => loadProducts()}>Search</Button>
      </div>
      {notice ? <div className="success-message" role="status">{notice}</div> : null}
      {error ? <Alert>{error}</Alert> : null}
      {loading ? <LoadingState label="Loading catalog..." /> : products.length === 0 ? <Panel><p className="empty-state">No products match these filters.</p></Panel> : <><div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} onAdd={add} />)}</div><div className="button-row"><Button className="button-secondary" type="button" disabled={page <= 1} onClick={() => loadProducts({ page: page - 1 })}>Previous</Button><span className="muted">Page {page} of {totalPages}</span><Button className="button-secondary" type="button" disabled={page >= totalPages} onClick={() => loadProducts({ page: page + 1 })}>Next</Button></div></>}
    </section>
  );
}

function ProductCard({ product, onAdd }: { product: Product; onAdd: (product: Product, quantity: number) => void }) {
  const [quantity, setQuantity] = useState(product.minimumQuantity);
  return (
    <Panel>
      <div className="product-card-head"><span className="product-category">{product.category.name}</span><strong>{product.currency} {product.price}</strong></div>
      <h2>{product.name}</h2>
      <p className="muted">{product.description || product.unitLabel || "Pharmacy product"}</p>
      <div className="badge-row">
        {product.prescriptionRequired ? <span className="badge badge-rx">Rx required</span> : null}
        {product.coldChainRequired ? <span className="badge badge-cold">Cold-chain {product.temperatureMinC ?? "2"}-{product.temperatureMaxC ?? "8"}°C</span> : null}
      </div>
      <p className="field-hint">Minimum quantity: {product.minimumQuantity}{product.unitLabel ? ` ${product.unitLabel}` : ""}</p>
      <div className="quantity-row"><Input aria-label={`Quantity for ${product.name}`} type="number" min={product.minimumQuantity} value={quantity} onChange={(event) => setQuantity(Math.max(product.minimumQuantity, Number(event.target.value) || product.minimumQuantity))} /><Button type="button" onClick={() => onAdd(product, quantity)}>Add to cart</Button></div>
    </Panel>
  );
}

function CartPanel({ cart, loading, error, onRefresh, onChange, onRemove, onClear, onCheckout }: { cart: Cart | null; loading: boolean; error: string | null; onRefresh: () => void; onChange: (id: string, quantity: number) => void; onRemove: (id: string) => void; onClear: () => void; onCheckout: () => void }) {
  if (!cart && loading) return <LoadingState label="Loading cart..." />;
  if (!cart) return <Panel><p className="empty-state">{error ?? "Cart is unavailable."}</p><Button type="button" onClick={onRefresh}>Retry</Button></Panel>;
  return <section className="content-grid"><div>{cart.items.length === 0 ? <Panel><h2>Your cart is empty</h2><p className="muted">Add products from the catalog to start an order.</p></Panel> : cart.items.map((item) => <Panel key={item.id}><div className="cart-line"><div><h2>{item.name}</h2><p className="muted">{cart.currency ?? ""} {item.unitPrice} each {item.prescriptionRequired ? "• Rx" : ""} {item.coldChainRequired ? "• 2–8°C" : ""}</p></div><div className="quantity-row"><Input aria-label={`Quantity for ${item.name}`} type="number" min={item.minimumQuantity} value={item.quantity} disabled={loading} onChange={(event) => onChange(item.productId, Math.max(item.minimumQuantity, Number(event.target.value) || item.minimumQuantity))} /><Button className="button-secondary" type="button" disabled={loading} onClick={() => onRemove(item.productId)}>Remove</Button></div></div></Panel>)}</div><Panel><h2>Cart summary</h2><p>Items: {cart.summary.itemCount}</p><p className="total">{cart.currency} {cart.summary.subtotal}</p>{!cart.validation.valid ? <div className="alert">{cart.validation.issues.map((issue) => <div key={`${issue.code}-${issue.productId}`}>{issue.message}</div>)}</div> : null}<div className="button-row"><Button className="button-secondary" type="button" disabled={!cart.items.length || loading} onClick={onClear}>Clear cart</Button><Button type="button" disabled={!cart.items.length || !cart.validation.valid || loading} onClick={onCheckout}>Continue to checkout</Button></div></Panel></section>;
}

function PatientPrescriptions() {
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const load = () => listPrescriptions().then((response) => setPrescriptions(response.items)).catch(setErrorMessage(setError)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  function submit(event: React.FormEvent): void { event.preventDefault(); if (!file) return; setError(null); setSubmitting(true); uploadPrescription(file, notes).then(() => { setNotice("Prescription uploaded for pharmacist review."); setFile(null); setNotes(""); load(); }).catch(setErrorMessage(setError)).finally(() => setSubmitting(false)); }
  return <section className="content-grid"><Panel><h2>Upload a prescription</h2><p className="muted">PDF, JPEG, PNG, or WEBP. Rx orders can only use a prescription after pharmacist verification.</p><form className="form-stack" onSubmit={submit}><Field label="Prescription file" htmlFor="prescription-file"><Input id="prescription-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /></Field><Field label="Notes (optional)" htmlFor="prescription-notes"><textarea className="input textarea" id="prescription-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>{error ? <Alert>{error}</Alert> : null}{notice ? <div className="success-message">{notice}</div> : null}<Button type="submit" disabled={!file || submitting}>{submitting ? <LoadingState label="Uploading..." /> : "Upload prescription"}</Button></form></Panel><Panel><h2>Your prescriptions</h2>{loading ? <LoadingState label="Loading prescriptions..." /> : prescriptions.length === 0 ? <p className="empty-state">No prescriptions uploaded yet.</p> : <div className="stack-list">{prescriptions.map((item) => <div className="list-row" key={item.id}><div><strong>{item.documentName}</strong><span className="muted">{new Date(item.createdAt).toLocaleDateString()}</span></div><span className={`status status-${item.status.toLowerCase()}`}>{item.status}</span></div>)}</div>}</Panel></section>;
}

function PatientOrders({ cart, onCartChange }: { cart: Cart | null; onCartChange: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [prescriptionId, setPrescriptionId] = useState("");
  const [pincode, setPincode] = useState("");
  const [method, setMethod] = useState<"PREPAID" | "COD">("PREPAID");
  const [codAvailable, setCodAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const referralToken = sessionStorage.getItem(referralTokenStorageKey) ?? undefined;
  const load = () => listOrders().then(setOrders).catch(setErrorMessage(setError));
  useEffect(() => { load(); listPrescriptions().then((response) => setPrescriptions(response.items.filter((item) => item.status === "VERIFIED"))).catch(() => undefined); }, []);
  const hasRx = cart?.items.some((item) => item.prescriptionRequired) ?? false;
  function checkout(): void { setError(null); createOrder({ prescriptionId: hasRx ? prescriptionId : undefined, referralToken }).then((order) => { setSelected(order); sessionStorage.removeItem(referralTokenStorageKey); onCartChange(); load(); setNotice("Order created. Add delivery details and payment."); }).catch(setErrorMessage(setError)); }
  function delivery(): void { if (!selected) return; setError(null); setDeliveryPincode(selected.id, pincode).then(() => validateDelivery(selected.id)).then((result) => { setSelected({ ...selected, deliveryPincode: pincode, deliveryFee: result.deliveryFee, totalAmount: result.totalAmount }); setCodAvailable(result.codAvailable); if (!result.codAvailable) setMethod("PREPAID"); setNotice(`Delivery validated via ${result.deliveryMode}.`); }).catch(setErrorMessage(setError)); }
  function pay(): void { if (!selected) return; setError(null); initiatePayment(selected.id, method).then((payment) => { if (method === "PREPAID" && payment.checkout) { openGatewayCheckout(payment.checkout); return; } setNotice(`${method === "COD" ? "COD" : "Prepaid"} payment initiated. Payment remains pending until provider confirmation.`); load(); }).catch(setErrorMessage(setError)); }
  function openGatewayCheckout(checkout: PaymentCheckout): void { loadRazorpayScript().then((loaded) => { if (!loaded || !window.Razorpay) { setError("Payment gateway could not be loaded. Please try again."); return; } const modal = new window.Razorpay({ key: checkout.keyId, order_id: checkout.gatewayOrderId, amount: checkout.amountMinor, currency: checkout.currency, name: "OncoEasy", description: `Pharmacy order ${checkout.orderId.slice(0, 8)}`, handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => { verifyPayment(checkout.orderId, { gatewayOrderId: response.razorpay_order_id, gatewayPaymentId: response.razorpay_payment_id, gatewaySignature: response.razorpay_signature }).then(() => { setNotice("Payment verified. The order is confirmed."); load(); }).catch(setErrorMessage(setError)); }, modal: { ondismiss: () => { setNotice("Payment window closed before completion. The payment remains pending."); } } }); modal.open(); }); }
  function loadRazorpayScript(): Promise<boolean> { if (window.Razorpay) return Promise.resolve(true); return new Promise((resolve) => { const script = document.createElement("script"); script.src = "https://checkout.razorpay.com/v1/checkout.js"; script.onload = () => resolve(true); script.onerror = () => resolve(false); document.body.appendChild(script); }); }
  return <section className="content-grid"><div><Panel><h2>Checkout</h2><p className="muted">Create an order from the active cart, then validate delivery before payment.</p>{hasRx ? <Field label="Verified prescription" htmlFor="checkout-prescription"><select className="input" id="checkout-prescription" value={prescriptionId} onChange={(event) => setPrescriptionId(event.target.value)}><option value="">Select a verified prescription</option>{prescriptions.map((item) => <option key={item.id} value={item.id}>{item.documentName}</option>)}</select></Field> : null}<Button type="button" disabled={!cart?.items.length || (hasRx && !prescriptionId)} onClick={checkout}>Create order</Button>{error ? <Alert>{error}</Alert> : null}{notice ? <div className="success-message">{notice}</div> : null}</Panel>{selected ? <Panel><h2>Order {selected.id.slice(0, 8)}</h2><p>Status: <strong>{selected.status}</strong></p><div className="form-stack"><Field label="Delivery pincode" htmlFor="delivery-pincode"><Input id="delivery-pincode" inputMode="numeric" value={pincode} onChange={(event) => setPincode(event.target.value)} /></Field><Button type="button" onClick={delivery} disabled={selected.status !== "PENDING_PAYMENT"}>Validate delivery</Button><p>Delivery fee: {selected.currency} {selected.deliveryFee}</p><p className="total">Total: {selected.currency} {selected.totalAmount}</p><Field label="Payment method" htmlFor="payment-method"><select className="input" id="payment-method" value={method} onChange={(event) => setMethod(event.target.value as "PREPAID" | "COD")}><option value="PREPAID">Prepaid</option>{codAvailable ? <option value="COD">Cash on delivery</option> : null}</select></Field><Button type="button" onClick={pay} disabled={selected.status !== "PENDING_PAYMENT" || (method === "COD" && !codAvailable)}>Initiate payment</Button></div></Panel> : null}</div><Panel><h2>Order history</h2>{orders.length === 0 ? <p className="empty-state">No pharmacy orders yet.</p> : <div className="stack-list">{orders.map((order) => <button className="list-row list-row-button" key={order.id} type="button" onClick={() => getOrder(order.id).then(setSelected).catch(setErrorMessage(setError))}><div><strong>{order.id.slice(0, 8)}</strong><span className="muted">{new Date(order.createdAt).toLocaleDateString()} • {order.items.length} item(s)</span></div><span className="status">{order.status}</span></button>)}</div>}</Panel></section>;
}

function StaffPharmacy({ role }: { role: "PHARMACIST" | "OPS_ADMIN" }) {
  const [queue, setQueue] = useState<Prescription[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [selected, setSelected] = useState<(Prescription & { documentAccess?: { reference: string; expiresAt: string } }) | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [deliveryId, setDeliveryId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => {
    if (role === "PHARMACIST" || role === "OPS_ADMIN") {
      listReviewQueue().then((response) => setQueue(response.items)).catch(setErrorMessage(setError));
    }
    listImports().then((response) => setImports(response.items)).catch(setErrorMessage(setError));
  };
  useEffect(() => {
    if (role === "PHARMACIST" || role === "OPS_ADMIN") {
      listReviewQueue().then((response) => setQueue(response.items)).catch(setErrorMessage(setError));
    }
    listImports().then((response) => setImports(response.items)).catch(setErrorMessage(setError));
  }, [role]);
  function review(action: "verify" | "reject" | "query"): void { if (!selected) return; const reason = action === "verify" ? undefined : window.prompt("Reason for this review action:") || ""; if (!reason) return; reviewPrescription(selected.id, action, reason).then(() => { setSelected(null); setNotice("Prescription review saved."); load(); }).catch(setErrorMessage(setError)); }
  function upload(event: React.FormEvent): void { event.preventDefault(); if (!file) return; importProducts(file).then((result) => { setNotice(`Import ${result.status}: ${result.createdProducts} created, ${result.updatedProducts} updated, ${result.invalidRows} invalid.`); setFile(null); load(); }).catch(setErrorMessage(setError)); }
  function assign(): void { assignDelivery(deliveryId, agentId).then(() => setNotice("Delivery assigned.")).catch(setErrorMessage(setError)); }
  return <section className="staff-grid">{error ? <Alert>{error}</Alert> : null}{notice ? <div className="success-message">{notice}</div> : null}      {role === "PHARMACIST" || role === "OPS_ADMIN" ? <Panel><h2>Prescription review queue</h2>{queue.length === 0 ? <p className="empty-state">No prescriptions are pending review.</p> : <div className="stack-list">{queue.map((item) => <button className="list-row list-row-button" type="button" key={item.id} onClick={() => getReviewPrescription(item.id).then(setSelected).catch(setErrorMessage(setError))}><div><strong>{item.documentName}</strong><span className="muted">Patient {item.patientId?.slice(0, 8)}</span></div><span className="status">{item.status}</span></button>)}</div>}{selected ? <div className="review-detail"><p><strong>{selected.documentName}</strong></p><p className="muted">{selected.notes || "No patient notes."}</p>{selected.documentAccess ? <a href={selected.documentAccess.reference} target="_blank" rel="noreferrer">Open private document</a> : null}<div className="button-row"><Button type="button" onClick={() => review("verify")}>Approve</Button><Button className="button-secondary" type="button" onClick={() => review("query")}>Query</Button><Button className="button-secondary" type="button" onClick={() => review("reject")}>Reject</Button></div></div> : null}</Panel> : null}{role === "OPS_ADMIN" ? <><AdminOrderQueue /><AdminDeliveryQueue /></> : null}<Panel><h2>Product Excel import</h2><form className="form-stack" onSubmit={upload}><Field label="XLSX file" htmlFor="product-import"><Input id="product-import" type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /></Field><Button type="submit" disabled={!file}>Import products</Button></form><h2 className="section-heading">Import history</h2>{imports.length === 0 ? <p className="empty-state">No imports yet.</p> : <div className="stack-list">{imports.map((item) => <div className="list-row" key={item.importJobId}><div><strong>{item.fileName || "Unnamed file"}</strong><span className="muted">{item.createdProducts} created • {item.updatedProducts} updated</span></div><span className="status">{item.status}</span></div>)}</div>}</Panel><Panel><h2>Assign local delivery</h2><p className="muted">Use the delivery ID and active delivery-agent user ID from the backend workflow.</p><Field label="Delivery ID" htmlFor="delivery-id"><Input id="delivery-id" value={deliveryId} onChange={(event) => setDeliveryId(event.target.value)} /></Field><Field label="Agent user ID" htmlFor="agent-id"><Input id="agent-id" value={agentId} onChange={(event) => setAgentId(event.target.value)} /></Field><Button type="button" disabled={!deliveryId || !agentId} onClick={assign}>Assign delivery</Button></Panel></section>;
}

function AdminOrderQueue() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = (nextPage = page, nextStatus = status): void => {
    setLoading(true);
    setError(null);
    listAdminOrders({ page: nextPage, pageSize: 20, status: nextStatus || undefined })
      .then((result) => { setOrders(result.items); setPage(nextPage); setTotalPages(result.pagination.totalPages); })
      .catch(setErrorMessage(setError))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    listAdminOrders({ page: 1, pageSize: 20 }).then((result) => { setOrders(result.items); setTotalPages(result.pagination.totalPages); }).catch(setErrorMessage(setError)).finally(() => setLoading(false));
  }, []);
  return (
    <Panel>
      <h2>Order queue</h2>
      <div className="pharmacy-toolbar">
        <select className="input" aria-label="Order status filter" value={status} onChange={(event) => { const value = event.target.value; setStatus(value); load(1, value); }}>
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <Button className="button-secondary" type="button" onClick={() => load()}>Refresh</Button>
      </div>
      {loading ? <LoadingState label="Loading orders..." /> : error ? <Alert>{error}</Alert> : orders.length === 0 ? <p className="empty-state">No orders match this filter.</p> : (
        <div className="stack-list">
          {orders.map((order) => (
            <button className="list-row list-row-button" key={order.id} type="button" onClick={() => getAdminOrder(order.id).then(setSelected).catch(setErrorMessage(setError))}>
              <div><strong>{order.id.slice(0, 8)}</strong><span className="muted">{order.patient.fullName} • {order.items.length} item(s) • {order.totalAmount} {order.currency}</span></div>
              <span className="status">{order.status}</span>
            </button>
          ))}
        </div>
      )}
      {totalPages > 1 && !loading ? (
        <div className="button-row">
          <Button className="button-secondary" type="button" disabled={page <= 1} onClick={() => load(page - 1)}>Previous</Button>
          <span className="muted">Page {page} of {totalPages}</span>
          <Button className="button-secondary" type="button" disabled={page >= totalPages} onClick={() => load(page + 1)}>Next</Button>
        </div>
      ) : null}
      {selected ? (
        <div className="review-detail">
          <p><strong>Order {selected.id.slice(0, 8)}</strong> — {selected.patient.fullName}</p>
          <p className="muted">Status {selected.status} • Placed {new Date(selected.createdAt).toLocaleDateString()} • Pincode {selected.deliveryPincode || "not set"}</p>
          <ul>{selected.items.map((item) => <li key={item.id}>{item.quantity} × {item.name} @ {item.unitPrice}</li>)}</ul>
          <p className="muted">Payment: {selected.payments.length ? selected.payments.map((payment) => `${payment.method} ${payment.status} (${payment.amount} ${payment.currency})`).join(", ") : "none initiated"}</p>
          <p className="muted">Delivery: {selected.delivery ? `${selected.delivery.mode} • ${selected.delivery.status}` : "not created"}</p>
        </div>
      ) : null}
    </Panel>
  );
}

function AdminDeliveryQueue() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = (nextPage = page, nextStatus = status, nextMode = mode): void => {
    setLoading(true);
    setError(null);
    listAdminDeliveries({ page: nextPage, pageSize: 20, status: nextStatus || undefined, mode: nextMode || undefined })
      .then((result) => { setDeliveries(result.items); setPage(nextPage); setTotalPages(result.pagination.totalPages); })
      .catch(setErrorMessage(setError))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    listAdminDeliveries({ page: 1, pageSize: 20 }).then((result) => { setDeliveries(result.items); setTotalPages(result.pagination.totalPages); }).catch(setErrorMessage(setError)).finally(() => setLoading(false));
  }, []);
  return (
    <Panel>
      <h2>Delivery queue</h2>
      <div className="pharmacy-toolbar">
        <select className="input" aria-label="Delivery status filter" value={status} onChange={(event) => { const value = event.target.value; setStatus(value); load(1, value, mode); }}>
          <option value="">All statuses</option>
          {DELIVERY_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select className="input" aria-label="Delivery mode filter" value={mode} onChange={(event) => { const value = event.target.value; setMode(value); load(1, status, value); }}>
          <option value="">All modes</option>
          <option value="LOCAL">Local</option>
          <option value="COURIER">Courier</option>
        </select>
        <Button className="button-secondary" type="button" onClick={() => load()}>Refresh</Button>
      </div>
      {loading ? <LoadingState label="Loading deliveries..." /> : error ? <Alert>{error}</Alert> : deliveries.length === 0 ? <p className="empty-state">No deliveries match this filter.</p> : (
        <div className="stack-list">
          {deliveries.map((delivery) => (
            <button className="list-row list-row-button" key={delivery.id} type="button" onClick={() => getAdminDelivery(delivery.id).then(setSelected).catch(setErrorMessage(setError))}>
              <div><strong>{delivery.id.slice(0, 8)}</strong><span className="muted">Order {delivery.order.id.slice(0, 8)} • {delivery.mode} • {delivery.order.totalAmount} {delivery.order.currency}</span></div>
              <span className="status">{delivery.status}</span>
            </button>
          ))}
        </div>
      )}
      {totalPages > 1 && !loading ? (
        <div className="button-row">
          <Button className="button-secondary" type="button" disabled={page <= 1} onClick={() => load(page - 1)}>Previous</Button>
          <span className="muted">Page {page} of {totalPages}</span>
          <Button className="button-secondary" type="button" disabled={page >= totalPages} onClick={() => load(page + 1)}>Next</Button>
        </div>
      ) : null}
      {selected ? (
        <div className="review-detail">
          <p><strong>Delivery {selected.id.slice(0, 8)}</strong> — order {selected.order.id.slice(0, 8)}</p>
          <p className="muted">Status {selected.status} • Mode {selected.mode} • Pincode {selected.order.deliveryPincode || "not set"}{selected.agentId ? ` • Agent ${selected.agentId.slice(0, 8)}` : " • Unassigned"}</p>
          <ul>{selected.order.items.map((item) => <li key={`${item.productNameSnapshot}-${item.quantity}`}>{item.quantity} × {item.productNameSnapshot}</li>)}</ul>
          {selected.proofs.length ? <p className="muted">Proofs: {selected.proofs.map((proof) => proof.type).join(", ")}</p> : null}
        </div>
      ) : null}
    </Panel>
  );
}

const ORDER_STATUSES = ["DRAFT", "PENDING_PRESCRIPTION", "PENDING_PHARMACIST_REVIEW", "PENDING_PAYMENT", "PAID", "PROCESSING", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "SHIPPED", "DELIVERED", "CANCELLED"];
const DELIVERY_STATUSES = ["PENDING", "ASSIGNED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "SHIPPED", "DELIVERED", "FAILED", "CANCELLED"];

function AgentPharmacy() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => listAssignedDeliveries().then(setDeliveries).catch(setErrorMessage(setError));
  useEffect(() => { load(); }, []);
  function action(name: "out-for-delivery" | "delivered"): void { if (!selected) return; transitionDelivery(selected.id, name).then((delivery) => { setSelected(delivery); setNotice(`Delivery marked ${delivery.status}.`); load(); }).catch(setErrorMessage(setError)); }
  function fail(): void { if (!selected) return; const reason = window.prompt("Reason for failed delivery:") || ""; if (reason) failDelivery(selected.id, reason).then((delivery) => { setSelected(delivery); load(); }).catch(setErrorMessage(setError)); }
  function proof(event: React.ChangeEvent<HTMLInputElement>, type: "DELIVERY_PHOTO" | "CASH_OVER_BILL" | "ONLINE_PAYMENT"): void { const file = event.target.files?.[0]; if (!file || !selected) return; uploadDeliveryProof(selected.id, file, type).then(() => { setNotice("Proof uploaded."); return getAssignedDelivery(selected.id); }).then(setSelected).catch(setErrorMessage(setError)); }
  return <section className="content-grid">{error ? <Alert>{error}</Alert> : null}{notice ? <div className="success-message">{notice}</div> : null}<Panel><h2>Assigned deliveries</h2>{deliveries.length === 0 ? <p className="empty-state">No assigned local deliveries.</p> : <div className="stack-list">{deliveries.map((delivery) => <button className="list-row list-row-button" key={delivery.id} type="button" onClick={() => getAssignedDelivery(delivery.id).then(setSelected).catch(setErrorMessage(setError))}><div><strong>{delivery.id.slice(0, 8)}</strong><span className="muted">Order {delivery.order.id.slice(0, 8)} • {delivery.order.totalAmount} {delivery.order.currency}</span></div><span className="status">{delivery.status}</span></button>)}</div>}</Panel>{selected ? <Panel><h2>Delivery {selected.id.slice(0, 8)}</h2><p>Order status: {selected.order.status}</p><p>Drop-off pincode: {selected.order.deliveryPincode || "Not provided"}</p><ul>{selected.order.items.map((item) => <li key={`${item.productNameSnapshot}-${item.quantity}`}>{item.quantity} × {item.productNameSnapshot}</li>)}</ul><div className="button-row"><Button type="button" disabled={selected.status !== "ASSIGNED"} onClick={() => action("out-for-delivery")}>Out for delivery</Button><Button type="button" disabled={selected.status !== "OUT_FOR_DELIVERY"} onClick={() => action("delivered")}>Mark delivered</Button><Button className="button-secondary" type="button" disabled={selected.status === "DELIVERED" || selected.status === "FAILED"} onClick={fail}>Failed</Button></div><div className="proof-grid"><Field label="Delivery photo" htmlFor="delivery-photo"><Input id="delivery-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => proof(event, "DELIVERY_PHOTO")} /></Field><Field label="COD cash proof" htmlFor="cash-proof"><Input id="cash-proof" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => proof(event, "CASH_OVER_BILL")} /></Field><Field label="COD online proof" htmlFor="online-proof"><Input id="online-proof" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => proof(event, "ONLINE_PAYMENT")} /></Field></div><p className="field-hint">Delivered orders require a delivery photo, and COD orders also require payment proof.</p></Panel> : null}</section>;
}

function setErrorMessage(setter: (message: string) => void) {
  return (error: unknown) => setter(error instanceof ApiError ? error.message : "The request could not be completed.");
}
function setError(setter: (message: string | null) => void) {
  return (error: unknown) => setter(error instanceof ApiError ? error.message : "The request could not be completed.");
}
