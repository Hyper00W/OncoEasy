export type CartValidationIssueCode =
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_INACTIVE"
  | "PRICE_CHANGED"
  | "MINIMUM_QUANTITY_NOT_MET"
  | "PRODUCT_DATA_CHANGED";

export type CartValidationIssue = {
  code: CartValidationIssueCode;
  cartItemId: string;
  productId: string;
  message: string;
};

type ValidationItem = {
  id: string;
  productId: string;
  quantity: number;
  unitPriceSnapshot: { toFixed(decimalPlaces: number): string };
  productNameSnapshot: string;
  product: {
    name: string;
    price: { toFixed(decimalPlaces: number): string };
    isActive: boolean;
    minimumQuantity: number;
  } | null;
};

export function validateCartItems(items: ValidationItem[]) {
  const issues: CartValidationIssue[] = [];

  for (const item of items) {
    if (!item.product) {
      issues.push({
        code: "PRODUCT_NOT_FOUND",
        cartItemId: item.id,
        productId: item.productId,
        message: "The product is no longer available"
      });
      continue;
    }

    if (!item.product.isActive) {
      issues.push({
        code: "PRODUCT_INACTIVE",
        cartItemId: item.id,
        productId: item.productId,
        message: "The product is no longer active"
      });
    }

    if (
      item.product.price.toFixed(2) !== item.unitPriceSnapshot.toFixed(2)
    ) {
      issues.push({
        code: "PRICE_CHANGED",
        cartItemId: item.id,
        productId: item.productId,
        message: "The current product price differs from the cart snapshot"
      });
    }

    if (item.quantity < item.product.minimumQuantity) {
      issues.push({
        code: "MINIMUM_QUANTITY_NOT_MET",
        cartItemId: item.id,
        productId: item.productId,
        message: `Quantity must be at least ${item.product.minimumQuantity}`
      });
    }

    if (item.product.name !== item.productNameSnapshot) {
      issues.push({
        code: "PRODUCT_DATA_CHANGED",
        cartItemId: item.id,
        productId: item.productId,
        message: "The current product name differs from the cart snapshot"
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}