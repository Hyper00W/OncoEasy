import { z } from "zod";

const decimalSchema = z.number().finite();

export const productCatalogInputSchema = z
  .object({
    sku: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().nullable().optional(),
    categoryId: z.string().uuid(),
    unitLabel: z.string().nullable().optional(),
    price: decimalSchema.min(0),
    currency: z.string().trim().length(3),
    isActive: z.boolean().default(true),
    prescriptionRequired: z.boolean().default(false),
    coldChainRequired: z.boolean().default(false),
    temperatureMinC: decimalSchema.nullable().optional(),
    temperatureMaxC: decimalSchema.nullable().optional(),
    minimumQuantity: z.number().int().min(1).default(1),
    regularDeliveryEligible: z.boolean().default(true),
    coldChainDeliveryEligible: z.boolean().default(false)
  })
  .superRefine((product, context) => {
    const hasMinimumTemperature = product.temperatureMinC !== null && product.temperatureMinC !== undefined;
    const hasMaximumTemperature = product.temperatureMaxC !== null && product.temperatureMaxC !== undefined;

    if (hasMinimumTemperature !== hasMaximumTemperature) {
      context.addIssue({
        code: "custom",
        path: ["temperatureMinC"],
        message: "Minimum and maximum temperatures must be provided together"
      });
    }

    if (!product.coldChainRequired && (hasMinimumTemperature || hasMaximumTemperature)) {
      context.addIssue({
        code: "custom",
        path: ["coldChainRequired"],
        message: "Non-cold-chain products cannot define temperature requirements"
      });
    }

    if (
      hasMinimumTemperature &&
      hasMaximumTemperature &&
      product.temperatureMinC! > product.temperatureMaxC!
    ) {
      context.addIssue({
        code: "custom",
        path: ["temperatureMinC"],
        message: "Minimum temperature cannot exceed maximum temperature"
      });
    }
  });

export type ProductCatalogInput = z.infer<typeof productCatalogInputSchema>;

export function parseProductCatalogInput(input: unknown): ProductCatalogInput {
  return productCatalogInputSchema.parse(input);
}
