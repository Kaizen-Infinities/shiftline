/**
 * Which products a sales-product kit can take as components. Only Sales Production items are
 * selectable; production items are shown greyed out (H40, E2E-B13).
 */
export interface PickerProduct {
  isActive?: boolean;
  productType?: string;
}

export const isSelectableComponent = (p: PickerProduct): boolean =>
  p.productType === "SALES_PRODUCTION";

/** True when an active production item is listed but cannot be picked, so the form must explain why. */
export const hasGreyedComponents = (products: PickerProduct[]): boolean =>
  products.some((p) => p.isActive !== false && !isSelectableComponent(p));
