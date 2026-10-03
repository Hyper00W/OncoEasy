import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ProductCard } from "../components/ProductCard";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { BackLink, Breadcrumbs, Button, Container, EmptyState, LoadingState } from "../components/ui";
import { CheckIcon, DocumentIcon, ThermometerIcon, TruckIcon } from "../components/icons";
import { addCartItem, getProduct, listProducts, type Product } from "../pharmacy/pharmacy-api";
import { STOREFRONT_PATH, formatMoney } from "../pharmacy/pharmacy-catalog";
import { SiteLink } from "../routing/SiteLink";
import { Reveal } from "../motion/motion";

type Navigate = (path: string) => void;
type DetailState = "loading" | "ready" | "notFound" | "error";

const RELATED_LIMIT = 4;

/**
 * Public product detail page (Phase 6.2). Everything shown comes from
 * GET /api/v1/pharmacy/products/:productId — the API has no image, MRP,
 * discount, or stock fields, so a branded monogram panel takes the place of
 * photography and nothing is fabricated. Prescription items explain the
 * pharmacist-verification flow instead of pretending they can ship instantly.
 */
export function ProductDetailPage({
  navigate,
  productId
}: {
  navigate: Navigate;
  productId: string;
}) {
  const { isAuthenticated, user } = useAuth();
  const isPatient = isAuthenticated && user?.role === "PATIENT";

  // Detail state machine is keyed by productId: state starts as "loading"
  // and is only advanced from async callbacks, never synchronously inside an
  // effect (react-hooks/set-state-in-effect). The key pattern below remounts
  // the loader when the id changes, replacing effect-body resets.
  const [state, setState] = useState<DetailState>("loading");
  const [product, setProduct] = useState<Product | null>(null);
  const [errorMessage, setErrorMessage] = useState("This product is unavailable right now.");
  const [related, setRelated] = useState<Product[]>([]);
  const [quantity, setQuantity] = useState(0);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const relatedTokenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    getProduct(productId)
      .then((loaded) => {
        if (cancelled) return;
        setProduct(loaded);
        setQuantity(loaded.minimumQuantity);
        setState("ready");

        const relatedToken = ++relatedTokenRef.current;
        listProducts({ category: loaded.category.slug, page: 1, pageSize: RELATED_LIMIT + 1 })
          .then((response) => {
            if (cancelled || relatedTokenRef.current !== relatedToken) return;
            setRelated(
              response.items.filter((item) => item.id !== loaded.id).slice(0, RELATED_LIMIT)
            );
          })
          .catch(() => undefined);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          setState("notFound");
        } else {
          setErrorMessage(
            error instanceof ApiError ? error.message : "This product is unavailable right now."
          );
          setState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [productId]);

  function handleAdd(): void {
    if (!product || adding) return;
    setAdding(true);
    setNotice(null);
    setAddError(null);
    addCartItem(product.id, quantity)
      .then(() => {
        setNotice(`${quantity}${product.unitLabel ? ` ${product.unitLabel}` : ""} added to your cart.`);
      })
      .catch((error: unknown) => {
        setAddError(error instanceof ApiError ? error.message : "Could not add to cart.");
      })
      .finally(() => setAdding(false));
  }

  return (
    <div className="site-page">
      <SiteHeader navigate={navigate} key={productId} />

      <main className="site-main">
        <Container className="storefront-head">
          <Breadcrumbs
            items={[
              { label: "Home", href: "/" },
              { label: "Pharmacy", href: STOREFRONT_PATH },
              ...(product ? [{ label: product.name }] : [{ label: "Product" }])
            ]}
          />
          <BackLink navigate={navigate} fallback={STOREFRONT_PATH} label="Back to Pharmacy" />
        </Container>

        <Container>
          {state === "loading" ? (
            <LoadingState label="Loading product..." />
          ) : state === "notFound" ? (
            <EmptyState
              title="This product is not available in the catalog."
              hint="It may have been removed. Browse the catalog for alternatives."
            />
          ) : state === "error" ? (
            <EmptyState title={errorMessage} hint="Try again from the catalog." />
          ) : product ? (
            <>
              <div className="detail-layout">
                <div className="detail-media" aria-hidden="true">
                  <span className="detail-monogram">{product.name.slice(0, 1).toUpperCase()}</span>
                </div>

                <div className="detail-info">
                  {product.category ? (
                    <SiteLink
                      className="detail-category"
                      href={`${STOREFRONT_PATH}?category=${encodeURIComponent(product.category.slug)}`}
                    >
                      {product.category.name}
                    </SiteLink>
                  ) : null}
                  <h1 className="detail-name">{product.name}</h1>

                  <div className="detail-badges">
                    {product.prescriptionRequired ? (
                      <span className="badge badge-rx">
                        <DocumentIcon size={12} /> Prescription required
                      </span>
                    ) : (
                      <span className="badge badge-success">No prescription needed</span>
                    )}
                    {product.coldChainRequired ? (
                      <span className="badge badge-cold">
                        <ThermometerIcon size={12} /> Cold chain {product.temperatureMinC ?? "2"}–
                        {product.temperatureMaxC ?? "8"}°C
                      </span>
                    ) : null}
                  </div>

                  <p className="detail-price">
                    {formatMoney(product.currency, product.price)}
                    {product.unitLabel ? <small> / {product.unitLabel}</small> : null}
                  </p>

                  {product.description ? (
                    <p className="detail-description">{product.description}</p>
                  ) : null}

                  <dl className="detail-facts">
                    <div className="detail-fact">
                      <dt>SKU</dt>
                      <dd>{product.sku}</dd>
                    </div>
                    <div className="detail-fact">
                      <dt>Minimum order</dt>
                      <dd>
                        {product.minimumQuantity}
                        {product.unitLabel ? ` ${product.unitLabel}` : ""}
                      </dd>
                    </div>
                    <div className="detail-fact">
                      <dt>Delivery</dt>
                      <dd>
                        {product.regularDeliveryEligible ? "Standard delivery" : ""}
                        {product.regularDeliveryEligible && product.coldChainDeliveryEligible
                          ? " + "
                          : ""}
                        {product.coldChainDeliveryEligible ? "cold-chain courier" : ""}
                        {!product.regularDeliveryEligible && !product.coldChainDeliveryEligible
                          ? "Not available for delivery"
                          : ""}
                      </dd>
                    </div>
                  </dl>

                  {product.prescriptionRequired ? (
                    <p className="detail-rx-note">
                      Prescription items are dispensed after a pharmacist verifies your uploaded
                      prescription. You can upload one from your pharmacy workspace before or after
                      adding this medicine to the cart.
                    </p>
                  ) : null}

                  {isPatient ? (
                    <div className="detail-actions">
                      <label className="detail-qty">
                        <span>Quantity</span>
                        <input
                          className="input"
                          type="number"
                          min={product.minimumQuantity}
                          value={quantity}
                          aria-label={`Quantity of ${product.name}`}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            setQuantity(Number.isFinite(next) && next >= 1 ? Math.floor(next) : product.minimumQuantity);
                          }}
                        />
                      </label>
                      <Button type="button" disabled={adding || quantity < product.minimumQuantity} onClick={handleAdd}>
                        {adding ? "Adding..." : "Add to cart"}
                      </Button>
                      <SiteLink className="button button-secondary" href="/patient/pharmacy?tab=cart">
                        View cart
                      </SiteLink>
                    </div>
                  ) : (
                    <div className="detail-actions">
                      <button
                        className="button"
                        type="button"
                        onClick={() => navigate("/")}
                      >
                        <CheckIcon size={16} /> Sign in as a patient to order
                      </button>
                    </div>
                  )}

                  {notice ? (
                    <p className="success-message" role="status">
                      {notice}
                    </p>
                  ) : null}
                  {addError ? (
                    <p className="alert" role="alert">
                      {addError}
                    </p>
                  ) : null}

                  <p className="detail-trust">
                    <TruckIcon size={14} /> Delivery availability for your pincode is confirmed at
                    checkout.
                  </p>
                </div>
              </div>

              {related.length > 0 ? (
                <section className="detail-related" aria-labelledby="related-heading">
                  <h2 id="related-heading">More in {product.category.name}</h2>
                  <div className="product-grid">
                    {related.map((item, index) => (
                      <Reveal key={item.id} as="div" delay={Math.min(index, 5) * 55} className="reveal-fade">
                        <ProductCard product={item} layout="grid" />
                      </Reveal>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </Container>
      </main>

      <SiteFooter navigate={navigate} />
    </div>
  );
}
