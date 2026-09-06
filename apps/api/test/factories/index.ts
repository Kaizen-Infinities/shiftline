import { faker } from "@faker-js/faker";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../helpers/db";

faker.seed(20260906);

const D = (n: number | string) => new Prisma.Decimal(n);
const code = (prefix: string) =>
  `${prefix}${faker.string.alphanumeric({ length: 6, casing: "upper" })}`;

export const demoCompany = async () => {
  const prisma = await getPrisma();
  return prisma.company.findUniqueOrThrow({ where: { companyCode: "DEMO" } });
};

export const demoOwner = async () => {
  const prisma = await getPrisma();
  return prisma.user.findUniqueOrThrow({ where: { username: "demo.owner" } });
};

export const createCustomer = async (
  overrides: Partial<Prisma.CustomerUncheckedCreateInput> = {}
) => {
  const prisma = await getPrisma();
  const company = await demoCompany();
  const owner = await demoOwner();
  return prisma.customer.create({
    data: {
      companyId: company.id,
      createdBy: owner.userId,
      customerCode: code("C"),
      firmName: `${faker.company.name()} (Test)`,
      displayName: faker.company.name(),
      creditLimit: D(100000),
      creditDays: 30,
      mobile: ["9000000000"],
      ...overrides,
    },
  });
};

export const createSupplier = async (
  overrides: Partial<Prisma.SupplierUncheckedCreateInput> = {}
) => {
  const prisma = await getPrisma();
  const company = await demoCompany();
  const owner = await demoOwner();
  return prisma.supplier.create({
    data: {
      companyId: company.id,
      createdBy: owner.userId,
      supplierCode: code("S"),
      legalName: `${faker.company.name()} (Test)`,
      billingAddressLine1: faker.location.streetAddress(),
      billingCity: "Chennai",
      billingState: "Tamil Nadu",
      billingPincode: "600001",
      stateCode: "33",
      mobile: ["9000000000"],
      ...overrides,
    },
  });
};

export const createProduct = async (
  overrides: Partial<Prisma.ProductUncheckedCreateInput> = {}
) => {
  const prisma = await getPrisma();
  const owner = await demoOwner();
  const nos = await prisma.unitOfMeasure.findUniqueOrThrow({ where: { uomCode: "NOS" } });
  return prisma.product.create({
    data: {
      productCode: code("P"),
      productName: faker.commerce.productName(),
      uomId: nos.id,
      rate: D(faker.number.int({ min: 10, max: 900 })),
      createdBy: owner.userId,
      ...overrides,
    },
  });
};

export const createRawMaterial = async (
  overrides: Partial<Prisma.RawMaterialUncheckedCreateInput> = {}
) => {
  const prisma = await getPrisma();
  const owner = await demoOwner();
  return prisma.rawMaterial.create({
    data: {
      rawMaterialId: code("RM"),
      materialName: `${faker.commerce.productMaterial()} ${faker.string.alpha(4)}`,
      baseUom: "KG",
      rate: D(100),
      onHandQty: D(500),
      storeId: "ST-RM",
      createdBy: owner.userId,
      ...overrides,
    },
  });
};
