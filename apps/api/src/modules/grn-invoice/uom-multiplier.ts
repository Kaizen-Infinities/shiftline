import { ApiError } from "../../utils/ApiError";

/**
 * Factor from a unit to its family's smallest unit (mg, ml, mm, ea). Division between two
 * factors gives the multiplier, so the values stay integers and the results stay exact.
 */
const UOM_FACTORS: Record<string, { family: string; factor: number }> = {
  mg: { family: "mass", factor: 1 },
  g: { family: "mass", factor: 1_000 },
  gram: { family: "mass", factor: 1_000 },
  grams: { family: "mass", factor: 1_000 },
  kg: { family: "mass", factor: 1_000_000 },
  kilogram: { family: "mass", factor: 1_000_000 },
  kilograms: { family: "mass", factor: 1_000_000 },
  mt: { family: "mass", factor: 1_000_000_000 },
  ton: { family: "mass", factor: 1_000_000_000 },
  tons: { family: "mass", factor: 1_000_000_000 },
  tonne: { family: "mass", factor: 1_000_000_000 },
  tonnes: { family: "mass", factor: 1_000_000_000 },
  ml: { family: "volume", factor: 1 },
  l: { family: "volume", factor: 1_000 },
  litre: { family: "volume", factor: 1_000 },
  litres: { family: "volume", factor: 1_000 },
  mm: { family: "length", factor: 1 },
  cm: { family: "length", factor: 10 },
  m: { family: "length", factor: 1_000 },
  ea: { family: "count", factor: 1 },
  each: { family: "count", factor: 1 },
  pc: { family: "count", factor: 1 },
  pcs: { family: "count", factor: 1 },
  nos: { family: "count", factor: 1 },
  no: { family: "count", factor: 1 },
  unit: { family: "count", factor: 1 },
  units: { family: "count", factor: 1 },
  dz: { family: "count", factor: 12 },
  dozen: { family: "count", factor: 12 },
};

/** The family's base unit (kg, l, m, ea), in the same units as the factors above. */
const FAMILY_BASE_FACTOR: Record<string, number> = {
  mass: 1_000_000,
  volume: 1_000,
  length: 1_000,
  count: 1,
};

/**
 * How many base units one line unit is. The base is the primary (first) unit of the raw
 * material's base UOM list. A unit from another family, or one we do not know, is refused:
 * guessing 1 turned 2 MT received into 2 kg (INV-B11, H10).
 */
export function getUomMultiplier(uom: string = "", baseUom: string = ""): number {
  const u = (uom || "").trim().toLowerCase();
  const b = (baseUom || "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (!u || u === b) return 1;

  const from = UOM_FACTORS[u];
  // No base unit to convert to: keep the family's base unit (kg, l, m, ea) as the target.
  if (!b) return from ? from.factor / FAMILY_BASE_FACTOR[from.family] : 1;

  const to = UOM_FACTORS[b];
  if (from && to && from.family === to.family) return from.factor / to.factor;

  throw new ApiError(400, `No unit conversion from ${uom.trim()} to ${baseUom.trim()}`);
}
