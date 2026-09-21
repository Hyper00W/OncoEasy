import { prisma } from "../../../database/prisma";
import { AppError } from "../../../errors/app-error";
import type { CartItemInput, CartItemQuantityInput } from "./cart.schemas";
import { toCartResponse } from "./cart.mapper";

const cartInclude = {
  items: {
    orderBy: { createdAt: "asc" as const },
    include: {
      product: {
        select: {
          sku: true,
          name: true,
          price: true,
          isActive: true,
          unitLabel: true,
          prescriptionRequired: true,
          coldChainRequired: true,
          temperatureMinC: true,
          temperatureMaxC: true,
          minimumQuantity: true,
          regularDeliveryEligible: true,
          coldChainDeliveryEligible: true
        }
      }
    }
  }
} as const;

export async function getActiveCart(patientId: string) {
  const cart = await prisma.cart.findFirst({
    where: { patientId, status: "ACTIVE" },
    include: cartInclude,
    orderBy: { createdAt: "asc" }
  });

  return toCartResponse(cart);
}

export async function addCartItem(patientId: string, input: CartItemInput) {
  const cart = await prisma.$transaction(async (transaction) => {
    const product = await findActiveProduct(transaction, input.productId);
    assertMinimumQuantity(input.quantity, product.minimumQuantity);

    let activeCart = await transaction.cart.findFirst({
      where: { patientId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" }
    });

    if (!activeCart) {
      activeCart = await transaction.cart.create({
        data: { patientId, currency: product.currency },
        include: cartInclude
      });
    }

    const existingItem = await transaction.cartItem.findUnique({
      where: { cartId_productId: { cartId: activeCart.id, productId: product.id } }
    });
    const quantity = (existingItem?.quantity ?? 0) + input.quantity;

    assertMinimumQuantity(quantity, product.minimumQuantity);
    await transaction.cartItem.upsert({
      where: { cartId_productId: { cartId: activeCart.id, productId: product.id } },
      create: {
        cartId: activeCart.id,
        productId: product.id,
        quantity,
        unitPriceSnapshot: product.price,
        productNameSnapshot: product.name
      },
      update: { quantity }
    });

    return transaction.cart.findUniqueOrThrow({
      where: { id: activeCart.id },
      include: cartInclude
    });
  });

  return toCartResponse(cart);
}

export async function updateCartItem(
  patientId: string,
  productId: string,
  input: CartItemQuantityInput
) {
  const cart = await prisma.$transaction(async (transaction) => {
    const product = await findActiveProduct(transaction, productId);
    assertMinimumQuantity(input.quantity, product.minimumQuantity);
    const activeCart = await findActiveCart(transaction, patientId);
    const item = await transaction.cartItem.findUnique({
      where: { cartId_productId: { cartId: activeCart.id, productId } }
    });

    if (!item) {
      throw new AppError(404, "CART_ITEM_NOT_FOUND", "Cart item was not found");
    }

    await transaction.cartItem.update({
      where: { id: item.id },
      data: { quantity: input.quantity }
    });

    return transaction.cart.findUniqueOrThrow({
      where: { id: activeCart.id },
      include: cartInclude
    });
  });

  return toCartResponse(cart);
}

export async function removeCartItem(patientId: string, productId: string) {
  const cart = await prisma.$transaction(async (transaction) => {
    const activeCart = await transaction.cart.findFirst({
      where: { patientId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" }
    });

    if (!activeCart) {
      return null;
    }

    await transaction.cartItem.deleteMany({
      where: { cartId: activeCart.id, productId }
    });

    return transaction.cart.findUniqueOrThrow({
      where: { id: activeCart.id },
      include: cartInclude
    });
  });

  return toCartResponse(cart);
}

export async function clearActiveCart(patientId: string) {
  const cart = await prisma.$transaction(async (transaction) => {
    const activeCart = await transaction.cart.findFirst({
      where: { patientId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" }
    });

    if (!activeCart) {
      return null;
    }

    await transaction.cartItem.deleteMany({ where: { cartId: activeCart.id } });
    return transaction.cart.findUniqueOrThrow({
      where: { id: activeCart.id },
      include: cartInclude
    });
  });

  return toCartResponse(cart);
}

async function findActiveCart(transaction: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], patientId: string) {
  const cart = await transaction.cart.findFirst({
    where: { patientId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" }
  });

  if (!cart) {
    throw new AppError(404, "CART_NOT_FOUND", "Active cart was not found");
  }

  return cart;
}

async function findActiveProduct(
  transaction: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  productId: string
) {
  const product = await transaction.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true, name: true, price: true, currency: true, minimumQuantity: true }
  });

  if (!product) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found");
  }

  return product;
}

function assertMinimumQuantity(quantity: number, minimumQuantity: number) {
  if (quantity < minimumQuantity) {
    throw new AppError(
      400,
      "MINIMUM_QUANTITY_NOT_MET",
      `Quantity must be at least ${minimumQuantity}`
    );
  }
}