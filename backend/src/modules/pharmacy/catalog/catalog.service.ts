import { prisma } from "../../../database/prisma";
import { AppError } from "../../../errors/app-error";
import type { ProductListQuery } from "./catalog.schemas";

const publicProductSelect = {
  id: true,
  sku: true,
  name: true,
  description: true,
  unitLabel: true,
  price: true,
  currency: true,
  prescriptionRequired: true,
  coldChainRequired: true,
  temperatureMinC: true,
  temperatureMaxC: true,
  minimumQuantity: true,
  regularDeliveryEligible: true,
  coldChainDeliveryEligible: true,
  category: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  }
} as const;

export async function listCategories() {
  return prisma.productCategory.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" }
  });
}

export async function listProducts(query: ProductListQuery) {
  const where = {
    isActive: true,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { sku: { contains: query.search, mode: "insensitive" as const } }
          ]
        }
      : {}),
    ...(query.category
      ? { category: { is: { slug: query.category, isActive: true } } }
      : {}),
    ...(query.prescriptionRequired === undefined
      ? {}
      : { prescriptionRequired: query.prescriptionRequired }),
    ...(query.coldChainRequired === undefined
      ? {}
      : { coldChainRequired: query.coldChainRequired })
  };
  const skip = (query.page - 1) * query.pageSize;

  const [total, products] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: publicProductSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take: query.pageSize
    })
  ]);

  return {
    items: products.map(toPublicProduct),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize)
    }
  };
}

export async function getProduct(productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true, category: { isActive: true } },
    select: publicProductSelect
  });

  if (!product) {
    throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found");
  }

  return toPublicProduct(product);
}

function toPublicProduct(product: {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unitLabel: string | null;
  price: { toString(): string };
  currency: string;
  prescriptionRequired: boolean;
  coldChainRequired: boolean;
  temperatureMinC: { toString(): string } | null;
  temperatureMaxC: { toString(): string } | null;
  minimumQuantity: number;
  regularDeliveryEligible: boolean;
  coldChainDeliveryEligible: boolean;
  category: { id: string; name: string; slug: string };
}) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    unitLabel: product.unitLabel,
    price: product.price.toString(),
    currency: product.currency,
    prescriptionRequired: product.prescriptionRequired,
    coldChainRequired: product.coldChainRequired,
    temperatureMinC: product.temperatureMinC?.toString() ?? null,
    temperatureMaxC: product.temperatureMaxC?.toString() ?? null,
    minimumQuantity: product.minimumQuantity,
    regularDeliveryEligible: product.regularDeliveryEligible,
    coldChainDeliveryEligible: product.coldChainDeliveryEligible
  };
}