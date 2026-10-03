import { useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button } from "./ui";
import { CheckIcon, ThermometerIcon } from "./icons";
import { addCartItem, type Product } from "../pharmacy/pharmacy-api";
import { formatMoney, productDetailPath } from "../pharmacy/pharmacy-catalog";
import { SiteLink } from "../routing/SiteLink";

type ProductCardState = "idle" | "adding" | "added" | "error";

/**
 * Catalog product card for the public storefront. Only API-provided fields are
 * rendered — the catalog API (Phase 1.7.5) has no image, MRP, discount, or
 * stock fields, so none are shown or fabricated. A branded monogram tile takes
 * the place of a product photo, and the category name acts as the accent line
 * a molecule/generic name would on other pharmacies.
 *
 * The whole card links to the product detail page; the add-to-cart button
 * stops propagation so it can sit inside the link without nesting buttons.
 * Anonymous visitors see a sign-in hint instead of add-to-cart because cart
 * writes require the PATIENT role (Phase 1.7.6).
 */
export function ProductCard({
  product,
  layout = "grid"
}: {
  product: Product;
  /** "grid" tiles the card vertically; "rail" suits horizontal product rails. */
  layout?: "grid" | "rail";
}) {
  const { isAuthenticated, user } = useAuth();
  const isPatient = isAuthenticated && user?.role === "PATIENT";
  const [state, setState] = useState<ProductCardState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const detailPath = productDetailPath(product.id);

  function handleAdd(): void {
    if (state === "adding") return;
    setState("adding");
    setMessage(null);
    addCartItem(product.id, product.minimumQuantity)
      .then(() => {
        setState("added");
        setMessage(`Added ${product.minimumQuantity}${product.unitLabel ? ` ${product.unitLabel}` : ""} to your cart.`);
      })
      .catch((error: unknown) => {
        setState("error");
        setMessage(error instanceof ApiError ? error.message : "Could not add to cart.");
      });
  }

  return (
    <article className={`product-card${layout === "rail" ? " product-card-rail" : ""}`}>
      <SiteLink href={detailPath} className="product-card-media" tabIndex={-1} aria-hidden="true">
        <span className="product-card-monogram">{product.name.slice(0, 1).toUpperCase()}</span>
      </SiteLink>

      <div className="product-card-body">
        <div className="product-card-top">
          <SiteLink href={detailPath} className="product-card-name-link">
            <h3>{product.name}</h3>
          </SiteLink>
          <div className="product-card-tags">
            {product.prescriptionRequired ? (
              <Badge tone="rx">Rx required</Badge>
            ) : null}
            {product.coldChainRequired ? (
              <Badge tone="cold">
                <ThermometerIcon size={12} /> {product.temperatureMinC ?? "2"}–{product.temperatureMaxC ?? "8"}°C
              </Badge>
            ) : null}
          </div>
        </div>

        <SiteLink href={detailPath} className="product-card-molecule">
          {product.category.name}
        </SiteLink>

        {product.description ? <p className="product-card-desc">{product.description}</p> : null}

        <p className="product-card-hint">
          Minimum {product.minimumQuantity}
          {product.unitLabel ? ` ${product.unitLabel}` : ""}
        </p>

        <div className="product-card-foot">
          <span className="product-price">
            {formatMoney(product.currency, product.price)}
            {product.unitLabel ? <small> / {product.unitLabel}</small> : null}
          </span>
          {isPatient ? (
            <Button
              type="button"
              className={state === "added" ? "button-secondary" : ""}
              disabled={state === "adding"}
              onClick={(event) => {
                event.stopPropagation();
                handleAdd();
              }}
            >
              {state === "adding" ? "Adding..." : state === "added" ? <CheckIcon size={16} /> : "Add to cart"}
            </Button>
          ) : null}
        </div>

        {message ? (
          <p className={state === "error" ? "field-hint" : "success-message"} role="status">
            {message}
          </p>
        ) : null}
        {!isPatient && state !== "error" ? (
          <p className="product-card-hint">Sign in as a patient to order.</p>
        ) : null}
      </div>
    </article>
  );
}
