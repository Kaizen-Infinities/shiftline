-- CreateEnum
CREATE TYPE "BusinessPlaceType" AS ENUM ('HEAD_OFFICE', 'BRANCH_OFFICE', 'FACTORY', 'WAREHOUSE', 'RETAIL_STORE');

-- CreateEnum
CREATE TYPE "MachineStatus" AS ENUM ('IDLE', 'RUNNING', 'BREAKDOWN', 'MAINTENANCE', 'MATERIAL_WAITING', 'SETUP');

-- CreateEnum
CREATE TYPE "MachineType" AS ENUM ('PRODUCTION', 'UTILITY');

-- CreateEnum
CREATE TYPE "TechnologyType" AS ENUM ('INJECTION_MOULDING', 'EXTRUSION', 'BLOW_MOULDING', 'ROTATIONAL_MOULDING', 'THERMOFORMING', 'COMPRESSION_MOULDING', 'PRINTING', 'GRANULATION', 'MIXING', 'RECYCLING');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'locked');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FLAT');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('active', 'inactive', 'resigned', 'retired', 'terminated');

-- CreateEnum
CREATE TYPE "RoleStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'USER_CREATED', 'USER_UPDATED', 'USER_DELETED', 'TOKEN_REFRESHED', 'LOGOUT_ALL_SESSIONS');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'PENDING_CUSTOMER_APPROVAL', 'CUSTOMER_APPROVED', 'CUSTOMER_REJECTED', 'CONFIRMED', 'QUOTATION_IN_PROGRESS', 'QUOTATION_COMPLETED', 'COMPLETED', 'CANCELLED', 'IN_PRODUCTION', 'PLANNED', 'MATERIAL_PENDING', 'MATERIAL_RESERVED', 'MATERIAL_ISSUED', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'FG_RECEIVED', 'READY_FOR_DISPATCH', 'PARTIALLY_DISPATCHED', 'DISPATCHED', 'QUOTED', 'INVOICED');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WastageType" AS ENUM ('STARTUP', 'MACHINE_SETUP', 'QUALITY_REJECTION', 'RAW_MATERIAL_WASTE', 'SCRAP', 'REWORK', 'MACHINE_BREAKDOWN', 'POWER_FAILURE', 'MOULD_CHANGE', 'COLOR_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('single', 'married', 'divorced', 'widowed');

-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('permanent', 'contract', 'intern', 'consultant', 'operator', 'supervisor');

-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('monthly', 'weekly', 'daily', 'hourly');

-- CreateEnum
CREATE TYPE "WastageStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StoreCategory" AS ENUM ('RAW_MATERIAL', 'FINISHED_GOODS', 'WASTAGE');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('PRODUCTION', 'SALES_PRODUCTION');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ItemCategoryType" AS ENUM ('RAW_MATERIAL', 'FINISHED_GOODS', 'SEMI_FINISHED', 'CONSUMABLE', 'WASTAGE');

-- CreateEnum
CREATE TYPE "EodItemCategory" AS ENUM ('RAW_MATERIAL', 'FINISHED_PRODUCT', 'WASTAGE');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('ASSET', 'LIABILITY', 'EXPENSE', 'INCOME', 'EQUITY');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('PAYMENT', 'RECEIPT', 'JOURNAL', 'CONTRA', 'SALES', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN', 'EXPENSE');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('PRODUCT', 'RAW_MATERIAL', 'WASTAGE');

-- CreateTable
CREATE TABLE "employees" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "empCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "mobile" VARCHAR(20),
    "email" VARCHAR(100),
    "dateOfJoining" TIMESTAMP(3),
    "departmentId" INTEGER,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "photoUrl" TEXT,
    "gender" "Gender",
    "dateOfBirth" DATE,
    "bloodGroup" TEXT,
    "maritalStatus" "MaritalStatus",
    "personalMobile" VARCHAR(20),
    "personalEmail" VARCHAR(100),
    "emergencyContactName" TEXT,
    "emergencyContactNumber" VARCHAR(20),
    "fatherName" TEXT,
    "motherName" TEXT,
    "spouseName" TEXT,
    "guardianName" TEXT,
    "guardianRelationship" TEXT,
    "aadhaarNumber" TEXT,
    "panNumber" TEXT,
    "drivingLicense" TEXT,
    "voterId" TEXT,
    "permanentAddressLine1" TEXT,
    "permanentAddressLine2" TEXT,
    "permanentCity" TEXT,
    "permanentState" TEXT,
    "permanentPincode" TEXT,
    "presentAddressLine1" TEXT,
    "presentAddressLine2" TEXT,
    "presentCity" TEXT,
    "presentState" TEXT,
    "presentPincode" TEXT,
    "designation" TEXT,
    "employeeType" "EmployeeType",
    "roleId" INTEGER,
    "relievingDate" TIMESTAMP(3),
    "previousExperience" TEXT,
    "probationPeriod" INTEGER,
    "noticePeriod" INTEGER,
    "shiftId" TEXT,
    "salaryType" "SalaryType",
    "basicSalary" DECIMAL(12,2),
    "grossSalary" DECIMAL(12,2),
    "pfApplicable" BOOLEAN NOT NULL DEFAULT false,
    "pfNumber" TEXT,
    "uanNumber" TEXT,
    "esiApplicable" BOOLEAN NOT NULL DEFAULT false,
    "esiNumber" TEXT,
    "professionalTax" BOOLEAN NOT NULL DEFAULT false,
    "tdsApplicable" BOOLEAN NOT NULL DEFAULT false,
    "paymentMode" TEXT DEFAULT 'BANK',
    "bankName" TEXT,
    "bankBranch" TEXT,
    "accountNumber" TEXT,
    "ifscCode" TEXT,
    "accountHolderName" TEXT,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" BIGSERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMPTZ(6),
    "roleId" INTEGER,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "userId" TEXT NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "employeeId" BIGINT,
    "roleId" INTEGER,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "mustChangePw" BOOLEAN NOT NULL DEFAULT false,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "lastLoginAt" TIMESTAMPTZ(6),
    "lastLoginIp" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "createdBy" TEXT,
    "createdOn" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedOn" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "adminId" BIGINT,
    "sessionToken" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceLabel" TEXT,
    "loginAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logoutAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "used" BOOLEAN NOT NULL DEFAULT false,
    "requestedIp" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminId" BIGINT,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" BIGSERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "userId" TEXT,
    "ipAddress" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "userAgent" TEXT,
    "attemptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminId" BIGINT,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID,
    "entityName" TEXT NOT NULL,
    "entityId" TEXT,
    "action" "AuditAction" NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "changedBy" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByAdmin" BIGINT,
    "request_id" VARCHAR(64),
    "actor_type" VARCHAR(20),
    "impersonated_by" VARCHAR(36),

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "code" TEXT NOT NULL DEFAULT 'ADMIN',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "status" "RoleStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_types" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_grades" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "email" VARCHAR(120),
    "gstin" VARCHAR(15),
    "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit_days" INTEGER,
    "transports" JSONB,
    "outstandingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "customerCode" VARCHAR(20) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "displayName" VARCHAR(80),
    "firmName" VARCHAR(160) NOT NULL,
    "mobile" JSONB,
    "searchTsv" tsvector,
    "status" VARCHAR(20) NOT NULL DEFAULT 'Active',
    "updatedBy" TEXT,
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openingBalanceType" VARCHAR(10) NOT NULL DEFAULT 'DEBIT',
    "customerTypeId" INTEGER,
    "customerGradeId" INTEGER,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "address" JSONB NOT NULL,
    "customer_id" UUID NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "label" VARCHAR(40) NOT NULL,
    "state_code" VARCHAR(50) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "companyCode" VARCHAR(20),
    "companyName" VARCHAR(160) NOT NULL,
    "legalName" VARCHAR(160),
    "shortName" VARCHAR(60),
    "gstin" VARCHAR(15),
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "phone" VARCHAR(20),
    "mobile" VARCHAR(1000),
    "email" VARCHAR(120),
    "website" VARCHAR(200),
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "addressLine1" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "zipcode" VARCHAR(20),
    "country" VARCHAR(100),
    "isOnboarded" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID,
    "updatedBy" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_configs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "phoneNumberId" VARCHAR(50) NOT NULL,
    "wabaId" VARCHAR(50) NOT NULL,
    "businessPhone" VARCHAR(20) NOT NULL,
    "accessToken" TEXT NOT NULL,
    "webhookVerifyToken" VARCHAR(100),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "whatsapp_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_configs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "smtpHost" VARCHAR(200) NOT NULL,
    "smtpPort" INTEGER NOT NULL,
    "smtpUsername" VARCHAR(200) NOT NULL,
    "smtpPassword" VARCHAR(200) NOT NULL,
    "fromEmail" VARCHAR(200) NOT NULL,
    "fromName" VARCHAR(160) NOT NULL,
    "encryption" VARCHAR(20) NOT NULL DEFAULT 'TLS',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_places" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "BusinessPlaceType" NOT NULL,
    "gstPlaceCode" VARCHAR(2),
    "phone" VARCHAR(20),
    "email" VARCHAR(120),
    "isHeadOffice" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "address" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "business_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "routeCode" TEXT NOT NULL,
    "routeName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierMaterialPrice" (
    "id" TEXT NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "supplierId" INTEGER NOT NULL,
    "rawMaterialId" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierMaterialPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "mobile" JSONB,
    "email" VARCHAR(120),
    "gstin" VARCHAR(15),
    "pan" VARCHAR(10),
    "alt_phone" VARCHAR(15),
    "billing_address_line1" VARCHAR(255) NOT NULL,
    "billing_city" VARCHAR(100) NOT NULL,
    "billing_state" VARCHAR(100) NOT NULL,
    "billing_pincode" VARCHAR(20) NOT NULL,
    "billing_country" VARCHAR(100) DEFAULT 'India',
    "contact_person" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "display_name" VARCHAR(80),
    "gst_reg_type" VARCHAR(20),
    "legal_name" VARCHAR(160) NOT NULL,
    "min_order_qty" DECIMAL(12,3),
    "state_code" VARCHAR(2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'Active',
    "supplier_code" VARCHAR(20) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" TEXT,
    "whatsapp" VARCHAR(15),
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "opening_balance_type" VARCHAR(10) NOT NULL DEFAULT 'CREDIT',
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_addresses" (
    "id" TEXT NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "address" JSONB NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "label" VARCHAR(40) NOT NULL,
    "state_code" VARCHAR(50) NOT NULL,

    CONSTRAINT "supplier_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "shiftCode" TEXT NOT NULL,
    "shiftName" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakDuration" INTEGER,
    "gracePeriod" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "productId" BIGINT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "description" TEXT,
    "uomId" INTEGER,
    "capacityLitres" DECIMAL(6,2),
    "weightPerPiece" DECIMAL(10,2),
    "weight_uom" VARCHAR(10) NOT NULL DEFAULT 'g',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "modifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rate" DECIMAL(12,2),
    "grade_rates" JSONB,
    "minimum_qty" TEXT NOT NULL DEFAULT '0',
    "product_type" "ProductType" NOT NULL DEFAULT 'PRODUCTION',
    "category_id" INTEGER,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_products" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "sales_product_code" TEXT NOT NULL,
    "sales_product_name" TEXT NOT NULL,
    "description" TEXT,
    "rate" DECIMAL(12,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "modified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_product_stocks" (
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "store_id" VARCHAR(20) NOT NULL,
    "sales_product_id" BIGINT NOT NULL,
    "on_hand_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_product_stocks_pkey" PRIMARY KEY ("store_id","sales_product_id")
);

-- CreateTable
CREATE TABLE "sales_product_components" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "sales_product_id" BIGINT NOT NULL,
    "component_product_id" BIGINT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "remarks" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_product_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_steps" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "product_id" BIGINT NOT NULL,
    "step_key" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,

    CONSTRAINT "production_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "uomCode" TEXT NOT NULL,
    "uomName" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "location_id" VARCHAR(20) NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "location_code" VARCHAR(30) NOT NULL,
    "location_name" VARCHAR(100) NOT NULL,
    "location_type" VARCHAR(50) NOT NULL,
    "address" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("location_id")
);

-- CreateTable
CREATE TABLE "machines" (
    "machine_id" VARCHAR(20) NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "machine_name" VARCHAR(100) NOT NULL,
    "technologyType" "TechnologyType",
    "machineType" "MachineType",
    "target_temperature" DECIMAL(5,2),
    "target_load_percent" DECIMAL(5,2),
    "manufacturer" VARCHAR(100),
    "model_number" VARCHAR(50),
    "cycle_time" DECIMAL(10,2),
    "operator_id" VARCHAR(20),
    "machineStatus" "MachineStatus" NOT NULL DEFAULT 'IDLE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "businessPlaceId" BIGINT,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("machine_id")
);

-- CreateTable
CREATE TABLE "stores" (
    "store_id" VARCHAR(20) NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "store_name" VARCHAR(120) NOT NULL,
    "store_category" "StoreCategory",
    "location_id" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),
    "allow_negative" BOOLEAN NOT NULL DEFAULT false,
    "cost_method" VARCHAR(10) NOT NULL DEFAULT 'WAVG',
    "gst_place" VARCHAR(50),
    "incharge_id" BIGINT,
    "location_desc" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'Active',
    "store_code" VARCHAR(20),
    "businessPlaceId" BIGINT,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("store_id")
);

-- CreateTable
CREATE TABLE "store_locations" (
    "id" TEXT NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "store_id" VARCHAR(20) NOT NULL,
    "parent_id" TEXT,
    "location_code" VARCHAR(20) NOT NULL,
    "location_type" VARCHAR(15) NOT NULL,
    "capacity_qty" DECIMAL(12,3),
    "capacity_uom" VARCHAR(8),
    "status" VARCHAR(15) NOT NULL DEFAULT 'Active',

    CONSTRAINT "store_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_materials" (
    "raw_material_id" VARCHAR(20) NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "material_name" VARCHAR(100) NOT NULL,
    "base_uom" VARCHAR(50) NOT NULL,
    "reorder_level" DECIMAL(14,3),
    "rate" DECIMAL(14,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),
    "store_id" VARCHAR(20),
    "minimum_stock" DECIMAL(14,3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'Active',
    "batch_no" VARCHAR(40),
    "last_movement_at" TIMESTAMP(3),
    "location_id" TEXT,
    "on_hand_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "qty_reserved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "narration" VARCHAR(255),
    "item_type" VARCHAR(50),
    "flagged_for_review" BOOLEAN NOT NULL DEFAULT false,
    "category_id" INTEGER,

    CONSTRAINT "raw_materials_pkey" PRIMARY KEY ("raw_material_id")
);

-- CreateTable
CREATE TABLE "bill_of_materials" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "product_id" BIGINT NOT NULL,
    "raw_material_id" VARCHAR(20) NOT NULL,
    "required_quantity" DECIMAL(12,3) NOT NULL,
    "percentage" DECIMAL(12,4),
    "uom" VARCHAR(10),
    "remarks" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_of_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finished_goods_stocks" (
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "store_id" VARCHAR(20) NOT NULL,
    "product_item_id" BIGINT NOT NULL,
    "on_hand_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finished_goods_stocks_pkey" PRIMARY KEY ("store_id","product_item_id")
);

-- CreateTable
CREATE TABLE "finished_goods_transactions" (
    "fg_txn_id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "txn_date_time" TIMESTAMP(3) NOT NULL,
    "store_id" VARCHAR(20) NOT NULL,
    "product_item_id" BIGINT NOT NULL,
    "txn_type" VARCHAR(30) NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "production_order_id" VARCHAR(20),
    "delivery_challan_id" VARCHAR(20),
    "invoice_id" VARCHAR(20),
    "related_doc_no" VARCHAR(30),
    "remarks" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(36),

    CONSTRAINT "finished_goods_transactions_pkey" PRIMARY KEY ("fg_txn_id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "production_order_id" VARCHAR(20) NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "order_date" TIMESTAMP(3) NOT NULL,
    "product_item_id" BIGINT NOT NULL,
    "target_qty" DECIMAL(14,3) NOT NULL,
    "uom" VARCHAR(10) NOT NULL,
    "source_sales_order_id" VARCHAR(20),
    "source_sales_order_line_id" BIGINT,
    "status" VARCHAR(30) NOT NULL DEFAULT 'CREATED',
    "remarks" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),
    "approved_at" TIMESTAMP(3),
    "approved_by" VARCHAR(36),
    "batch_no" VARCHAR(40),
    "bom_id" VARCHAR(20),
    "destination_store_id" VARCHAR(20),
    "due_date" TIMESTAMP(3) NOT NULL,
    "lot_no" VARCHAR(40),
    "machineMachineId" VARCHAR(20),
    "orderType" VARCHAR(30) NOT NULL DEFAULT 'STANDARD',
    "priority" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    "produced_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "rejected_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "routing_id" VARCHAR(20),
    "scrap_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "source_store_id" VARCHAR(20),
    "required_raw_material_qty" DECIMAL(14,3),
    "weight_per_piece_used" DECIMAL(10,3),
    "draft_raw_materials" JSONB,
    "current_production_step" VARCHAR(100),
    "current_step_index" INTEGER,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("production_order_id")
);

-- CreateTable
CREATE TABLE "goods_dispatches" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "dispatch_number" VARCHAR(30) NOT NULL,
    "dispatch_date" DATE NOT NULL,
    "vehicle_number" VARCHAR(30) NOT NULL,
    "driver_name" VARCHAR(100) NOT NULL,
    "driver_mobile" VARCHAR(20),
    "transport_name" VARCHAR(100),
    "loading_time" VARCHAR(10),
    "remarks" VARCHAR(500),
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING_GATE_APPROVAL',
    "gate_approved_by" VARCHAR(36),
    "gate_approved_at" TIMESTAMP(3),
    "gate_remarks" VARCHAR(500),
    "store_received_by" VARCHAR(36),
    "store_received_at" TIMESTAMP(3),
    "store_remarks" VARCHAR(500),
    "destination_store_id" VARCHAR(20),
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_operation_assignments" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "machine_id" VARCHAR(20) NOT NULL,
    "week_start_date" DATE NOT NULL,
    "week_end_date" DATE NOT NULL,
    "incharge_role_id" INTEGER,
    "incharge_employee_id" BIGINT,
    "remarks" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "shift_id" VARCHAR(20),

    CONSTRAINT "machine_operation_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_assignment_operators" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "assignment_id" BIGINT NOT NULL,
    "role_id" INTEGER NOT NULL,
    "employee_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_assignment_operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_dispatch_items" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "dispatch_id" BIGINT NOT NULL,
    "production_order_id" VARCHAR(20) NOT NULL,
    "product_item_id" BIGINT NOT NULL,
    "dispatch_qty" DECIMAL(14,3) NOT NULL,
    "uom" VARCHAR(10) NOT NULL,
    "received_qty" DECIMAL(14,3),
    "remarks" VARCHAR(255),

    CONSTRAINT "goods_dispatch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_machine_programs" (
    "weekly_program_id" VARCHAR(20) NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "week_start_date" DATE NOT NULL,
    "week_end_date" DATE NOT NULL,
    "machine_id" VARCHAR(20),
    "day_of_week" INTEGER NOT NULL,
    "shift_id" VARCHAR(20),
    "planned_qty" DECIMAL(12,3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "remarks" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),
    "approved_at" TIMESTAMP(3),
    "approved_by" VARCHAR(36),
    "planned_hours" DECIMAL(10,2),
    "priority" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    "productId" BIGINT,
    "production_order_id" VARCHAR(20) NOT NULL,
    "sequence_no" INTEGER NOT NULL DEFAULT 1,
    "setup_hours" DECIMAL(10,2),

    CONSTRAINT "weekly_machine_programs_pkey" PRIMARY KEY ("weekly_program_id")
);

-- CreateTable
CREATE TABLE "hourly_productions" (
    "hourly_production_id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "production_order_id" VARCHAR(20) NOT NULL,
    "production_date" DATE NOT NULL,
    "shift_id" VARCHAR(20) NOT NULL,
    "machine_id" VARCHAR(20) NOT NULL,
    "hour_index" INTEGER NOT NULL,
    "qty_produced" DECIMAL(14,3) NOT NULL,
    "reject_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "scrap_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "downtime" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "runtime_minutes" DECIMAL(10,2) NOT NULL DEFAULT 60,
    "remarks" VARCHAR(255),
    "downtime_reason" VARCHAR(100),
    "reject_reason" VARCHAR(100),
    "scrap_reason" VARCHAR(100),
    "operator_id" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "daily_plan_id" VARCHAR(50),

    CONSTRAINT "hourly_productions_pkey" PRIMARY KEY ("hourly_production_id")
);

-- CreateTable
CREATE TABLE "daily_production_plans" (
    "daily_plan_id" VARCHAR(50) NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "weekly_program_id" VARCHAR(20) NOT NULL,
    "production_order_id" VARCHAR(20) NOT NULL,
    "production_date" DATE NOT NULL,
    "machine_id" VARCHAR(20) NOT NULL,
    "shift_id" VARCHAR(20) NOT NULL,
    "planned_qty" DECIMAL(12,3) NOT NULL,
    "planned_hours" DECIMAL(10,2),
    "priority" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "remarks" VARCHAR(255),
    "selected_operator_ids" VARCHAR(255),
    "carry_forward_from_plan_id" VARCHAR(50),
    "current_production_step" VARCHAR(100),
    "current_step_index" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),

    CONSTRAINT "daily_production_plans_pkey" PRIMARY KEY ("daily_plan_id")
);

-- CreateTable
CREATE TABLE "raw_material_transactions" (
    "rm_txn_id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "store_id" VARCHAR(20) NOT NULL,
    "raw_material_id" VARCHAR(20) NOT NULL,
    "txn_type" VARCHAR(30) NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "txn_date_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "production_order_id" VARCHAR(20),

    CONSTRAINT "raw_material_transactions_pkey" PRIMARY KEY ("rm_txn_id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "orderNo" VARCHAR(30) NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "isInterState" BOOLEAN NOT NULL DEFAULT false,
    "customerId" UUID NOT NULL,
    "mobile" VARCHAR(20),
    "referenceText" VARCHAR(255),
    "narration" TEXT,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "order_discount_type" VARCHAR(10),
    "order_discount_value" DECIMAL(14,2),
    "total_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "orderType" TEXT,
    "salesPersonName" VARCHAR(100),
    "source_sales_order_id" INTEGER,
    "order_source" VARCHAR(30),
    "source_employee_id" BIGINT,
    "referred_by_customer_id" UUID,
    "referred_by_name" VARCHAR(100),
    "bill_sundry" JSONB,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_items" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "salesOrderId" INTEGER NOT NULL,
    "productId" BIGINT NOT NULL,
    "sales_product_id" BIGINT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "invoicedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "quotation_unit_price" DECIMAL(14,2),
    "lineTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "poNumber" TEXT NOT NULL,
    "poDate" DATE NOT NULL,
    "expectedDeliveryDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "rejectReason" TEXT,
    "sameAsBilling" BOOLEAN NOT NULL DEFAULT false,
    "billingAddressLine1" TEXT NOT NULL,
    "billingCity" TEXT NOT NULL,
    "billingState" TEXT NOT NULL,
    "billingPincode" TEXT NOT NULL,
    "billing_country" TEXT DEFAULT 'India',
    "shippingAddressLine1" TEXT NOT NULL,
    "shippingCity" TEXT NOT NULL,
    "shippingState" TEXT NOT NULL,
    "shippingPincode" TEXT NOT NULL,
    "shipping_country" TEXT DEFAULT 'India',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalCgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalSgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalIgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rounding_adjust" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "store_id" VARCHAR(20),
    "discount_type" "DiscountType" NOT NULL DEFAULT 'PERCENT',
    "discount_value" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "purchaseOrderId" UUID NOT NULL,
    "uom" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "receivedQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountType" "DiscountType" NOT NULL DEFAULT 'PERCENT',
    "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grn_invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "grn_number" TEXT NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "grn_date" DATE NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "store_id" VARCHAR(20) NOT NULL,
    "billing_address_line1" TEXT NOT NULL,
    "billing_city" TEXT NOT NULL,
    "billing_state" TEXT NOT NULL,
    "billing_pincode" TEXT NOT NULL,
    "billing_country" TEXT DEFAULT 'India',
    "same_as_billing" BOOLEAN NOT NULL DEFAULT false,
    "update_stock" BOOLEAN NOT NULL DEFAULT false,
    "shipping_address_line1" TEXT NOT NULL,
    "shipping_city" TEXT NOT NULL,
    "shipping_state" TEXT NOT NULL,
    "shipping_pincode" TEXT NOT NULL,
    "shipping_country" TEXT DEFAULT 'India',
    "receive_date" DATE,
    "bill_due_date" DATE,
    "challan_no" TEXT,
    "transport" TEXT,
    "eway_bill" TEXT,
    "invoice_image" TEXT,
    "remarks" TEXT,
    "discount_type" "DiscountType" NOT NULL DEFAULT 'PERCENT',
    "discount_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rounding_adjust" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_status" TEXT NOT NULL DEFAULT 'Unpaid',
    "payment_method" TEXT,
    "reference_number" TEXT,
    "payment_date" DATE,
    "payments" JSONB DEFAULT '[]',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalCgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalSgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalIgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "po_id" UUID,

    CONSTRAINT "grn_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grn_invoice_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "grn_invoice_id" UUID NOT NULL,
    "product_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grn_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grn_invoice_payments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "grn_invoice_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_method" VARCHAR(50) NOT NULL,
    "reference_number" VARCHAR(100),
    "payment_date" DATE NOT NULL,
    "recorded_by" VARCHAR(36),
    "voucher_posted" BOOLEAN NOT NULL DEFAULT false,
    "source_voucher_id" VARCHAR(36),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grn_invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_wastages" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "wastage_no" VARCHAR(30) NOT NULL,
    "wastage_date" DATE NOT NULL,
    "production_order_id" VARCHAR(20) NOT NULL,
    "hourly_production_id" BIGINT,
    "machine_id" VARCHAR(20) NOT NULL,
    "shift_id" VARCHAR(20) NOT NULL,
    "product_id" BIGINT NOT NULL,
    "raw_material_id" VARCHAR(20),
    "wastage_type" "WastageType" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "uom" VARCHAR(10) NOT NULL,
    "estimated_value" DECIMAL(18,2),
    "reason" VARCHAR(255),
    "corrective_action" VARCHAR(255),
    "remarks" VARCHAR(255),
    "is_recyclable" BOOLEAN NOT NULL DEFAULT false,
    "sent_for_rework" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" VARCHAR(36),
    "approved_at" TIMESTAMP(3),
    "status" "WastageStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" VARCHAR(36) NOT NULL,
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "target_wastage_product_id" VARCHAR(20),
    "store_id" VARCHAR(20),
    "category_id" INTEGER,

    CONSTRAINT "production_wastages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "adj_id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "adjustment_number" VARCHAR(50) NOT NULL,
    "adjustment_date" TIMESTAMP(3) NOT NULL,
    "adjustment_type" VARCHAR(40) NOT NULL DEFAULT 'STOCK_INCREASE',
    "reason" VARCHAR(255),
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by" VARCHAR(36),
    "approved_at" TIMESTAMP(3),
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "source_document" VARCHAR(50),
    "source_doc_id" VARCHAR(50),
    "auto_generated" BOOLEAN NOT NULL DEFAULT false,
    "type" VARCHAR(50),
    "production_order_id" VARCHAR(20),

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("adj_id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_items" (
    "adj_item_id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "stock_adjustment_id" BIGINT NOT NULL,
    "item_type" "ItemCategoryType" NOT NULL,
    "raw_material_id" VARCHAR(20),
    "product_item_id" BIGINT,
    "store_id" VARCHAR(20) NOT NULL,
    "current_qty" DECIMAL(14,3) NOT NULL,
    "adjusted_qty" DECIMAL(14,3) NOT NULL,
    "difference" DECIMAL(14,3) NOT NULL,
    "remarks" VARCHAR(255),
    "unit_cost" DECIMAL(14,2),
    "batch_no" VARCHAR(40),

    CONSTRAINT "stock_adjustment_items_pkey" PRIMARY KEY ("adj_item_id")
);

-- CreateTable
CREATE TABLE "production_order_history" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "production_order_id" VARCHAR(20) NOT NULL,
    "from_status" VARCHAR(30),
    "to_status" VARCHAR(30) NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" VARCHAR(36),
    "remarks" VARCHAR(500),
    "action" VARCHAR(100),
    "metadata" JSONB,

    CONSTRAINT "production_order_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "expenseNumber" VARCHAR(30) NOT NULL,
    "expenseCategory" VARCHAR(60) NOT NULL,
    "date" DATE NOT NULL,
    "expense" VARCHAR(120) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "paymentMethod" VARCHAR(50) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'Draft',
    "notes" TEXT,
    "receiptInvoice" VARCHAR(255),
    "supplierId" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "invoice_prefix" VARCHAR(20) NOT NULL DEFAULT 'INV',
    "sequence_length" INTEGER NOT NULL DEFAULT 4,
    "current_sequence_number" INTEGER NOT NULL DEFAULT 1,
    "financial_year_start" DATE NOT NULL,
    "financial_year_end" DATE NOT NULL,
    "auto_financial_year" BOOLEAN NOT NULL DEFAULT true,
    "format_template" VARCHAR(100) NOT NULL DEFAULT '{PREFIX}-{FY}-{SEQ}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "invoice_no" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "customer_id" UUID NOT NULL,
    "notes" TEXT,
    "sub_total" DECIMAL(14,2) NOT NULL,
    "discount_type" VARCHAR(10),
    "discount_value" DECIMAL(14,2),
    "total_discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(14,2) NOT NULL,
    "grand_total" DECIMAL(14,2) NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "sales_order_id" INTEGER,
    "store_id" VARCHAR(20),
    "payments" JSONB DEFAULT '[]',
    "narration" VARCHAR(2000),
    "transport" JSONB,
    "number_of_bundle" INTEGER,
    "bill_sundry" JSONB,
    "shipping_address_line1" VARCHAR(255),
    "shipping_city" VARCHAR(100),
    "shipping_state" VARCHAR(100),
    "shipping_pincode" VARCHAR(20),

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "sales_invoice_id" UUID NOT NULL,
    "product_id" BIGINT NOT NULL,
    "description" TEXT,
    "uom" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(12,2) NOT NULL,
    "weight" DECIMAL(12,3) DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "sales_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_payments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "sales_invoice_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_method" VARCHAR(50) NOT NULL,
    "reference_number" VARCHAR(100),
    "payment_date" DATE NOT NULL,
    "recorded_by" VARCHAR(36),
    "voucher_posted" BOOLEAN NOT NULL DEFAULT false,
    "source_voucher_id" VARCHAR(36),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_oee_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "machine_id" VARCHAR(20) NOT NULL,
    "daily_plan_id" VARCHAR(50),
    "production_date" DATE NOT NULL,
    "shift_id" VARCHAR(20) NOT NULL,
    "planned_run_time" DECIMAL(10,2) NOT NULL,
    "actual_run_time" DECIMAL(10,2) NOT NULL,
    "total_downtime" DECIMAL(10,2) NOT NULL,
    "total_produced" DECIMAL(14,3) NOT NULL,
    "good_qty" DECIMAL(14,3) NOT NULL,
    "reject_qty" DECIMAL(14,3) NOT NULL,
    "availability" DECIMAL(5,2) NOT NULL,
    "performance" DECIMAL(5,2) NOT NULL,
    "quality" DECIMAL(5,2) NOT NULL,
    "oee_percent" DECIMAL(5,2) NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_oee_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eod_stock_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "category" "EodItemCategory" NOT NULL,
    "item_id" VARCHAR(100) NOT NULL,
    "item_code" VARCHAR(100) NOT NULL,
    "item_name" VARCHAR(255) NOT NULL,
    "uom" VARCHAR(50),
    "store_id" VARCHAR(100) NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "start_qty" DECIMAL(14,3) NOT NULL,
    "eod_qty" DECIMAL(14,3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eod_stock_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "key" VARCHAR(100) NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_shift_records" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "product_id" BIGINT NOT NULL,
    "production_order_id" VARCHAR(20) NOT NULL,
    "machine_id" VARCHAR(20) NOT NULL,
    "shift_id" VARCHAR(20) NOT NULL,
    "achieved_qty" DECIMAL(14,3) NOT NULL,
    "target_qty" DECIMAL(14,3) NOT NULL,
    "recorded_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operator_ids" VARCHAR(255),
    "is_highest" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_shift_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_capacity_history" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "product_id" BIGINT NOT NULL,
    "previous_capacity" DECIMAL(14,3) NOT NULL,
    "new_capacity" DECIMAL(14,3) NOT NULL,
    "production_date" DATE NOT NULL,
    "machine_id" VARCHAR(20) NOT NULL,
    "shift_id" VARCHAR(20) NOT NULL,
    "production_order_id" VARCHAR(20) NOT NULL,
    "target_qty" DECIMAL(14,3) NOT NULL,
    "actual_qty" DECIMAL(14,3) NOT NULL,
    "achievement_pct" DECIMAL(8,2) NOT NULL,
    "operators" VARCHAR(255),
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_capacity_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "type" "CategoryType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_ledgers" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "type" "LedgerType" NOT NULL,
    "group" VARCHAR(80) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "customerId" UUID,
    "supplierId" INTEGER,

    CONSTRAINT "account_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "voucherNo" VARCHAR(30) NOT NULL,
    "type" "VoucherType" NOT NULL,
    "date" DATE NOT NULL,
    "narration" VARCHAR(500),
    "refDocType" VARCHAR(30),
    "refDocId" VARCHAR(36),
    "createdBy" VARCHAR(36),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_items" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "voucherId" INTEGER NOT NULL,
    "debitLedgerId" INTEGER,
    "creditLedgerId" INTEGER,
    "debitAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "narration" VARCHAR(255),

    CONSTRAINT "journal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_returns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "returnNo" VARCHAR(30) NOT NULL,
    "returnDate" DATE NOT NULL,
    "customerId" UUID NOT NULL,
    "salesInvoiceId" UUID,
    "reason" VARCHAR(255),
    "refundMode" VARCHAR(20) NOT NULL DEFAULT 'CREDIT_NOTE',
    "subTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'APPROVED',
    "narration" VARCHAR(500),
    "createdBy" VARCHAR(36),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_items" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "salesReturnId" UUID NOT NULL,
    "productId" BIGINT NOT NULL,
    "salesInvoiceItemId" UUID,
    "quantity" DECIMAL(12,3) NOT NULL,
    "weight" DECIMAL(12,3),
    "uom" VARCHAR(20),
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "reason" VARCHAR(255),

    CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "returnNo" VARCHAR(30) NOT NULL,
    "returnDate" DATE NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "grnInvoiceId" UUID,
    "reason" VARCHAR(255),
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'APPROVED',
    "narration" VARCHAR(500),
    "createdBy" VARCHAR(36),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_items" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "purchaseReturnId" UUID NOT NULL,
    "rawMaterialId" VARCHAR(20) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "reason" VARCHAR(255),

    CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petty_cash_entries" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "entryNo" VARCHAR(30) NOT NULL,
    "entryDate" DATE NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "description" VARCHAR(255),
    "amount" DECIMAL(14,2) NOT NULL,
    "type" VARCHAR(3) NOT NULL,
    "paidTo" VARCHAR(160),
    "receiptNo" VARCHAR(50),
    "createdBy" VARCHAR(36),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "petty_cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "periodName" VARCHAR(50) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "closedBy" VARCHAR(36),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "employeeId" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "shiftId" INTEGER,
    "otHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "permissionMinutes" INTEGER NOT NULL DEFAULT 0,
    "salaryAdvance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_payroll_configs" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "employeeId" BIGINT NOT NULL,
    "salaryType" TEXT NOT NULL,
    "monthlySalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "basicSalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "da" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "hra" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherAllowance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashInHand" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dailySalary" DECIMAL(14,2),
    "bankAccount" TEXT,
    "ifscCode" TEXT,
    "bankName" TEXT,
    "pfNumber" TEXT,
    "esiNumber" TEXT,
    "paymentMode" TEXT NOT NULL DEFAULT 'CASH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_payroll_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_configs" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "dailySalaryFormula" TEXT NOT NULL DEFAULT 'MONTHLY_BY_CALENDAR',
    "salaryCalculationMethod" TEXT NOT NULL DEFAULT 'CALENDAR_DAYS',
    "fixedDays" INTEGER NOT NULL DEFAULT 26,
    "defaultWorkingHoursPerDay" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "weeklyOffDays" JSONB NOT NULL DEFAULT '[0]',
    "otEnabled" BOOLEAN NOT NULL DEFAULT true,
    "otMethod" TEXT NOT NULL DEFAULT 'SLAB',
    "otRatePerHour" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "weekdayOtMultiplier" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "holidayOtMultiplier" DECIMAL(5,2) NOT NULL DEFAULT 2.0,
    "weeklyOffOtMultiplier" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "maxOtHoursPerDay" DECIMAL(5,2) NOT NULL DEFAULT 4,
    "maxOtHoursPerWeek" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "otSlabs" JSONB NOT NULL DEFAULT '[]',
    "pfEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pfWageFormula" TEXT NOT NULL DEFAULT 'BASIC',
    "employeePfPercent" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "employerPfPercent" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "maxPfWage" DECIMAL(10,2) NOT NULL DEFAULT 15000,
    "pfRoundingRule" TEXT NOT NULL DEFAULT 'ROUND',
    "esiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "employeeEsiPercent" DECIMAL(5,3) NOT NULL DEFAULT 0.75,
    "employerEsiPercent" DECIMAL(5,3) NOT NULL DEFAULT 3.25,
    "maxEsiSalary" DECIMAL(10,2) NOT NULL DEFAULT 21000,
    "esiRoundingRule" TEXT NOT NULL DEFAULT 'ROUND',
    "paidLeavePerYear" INTEGER NOT NULL DEFAULT 12,
    "lateEntryGraceMinutes" INTEGER NOT NULL DEFAULT 5,
    "permissionSlabs" JSONB NOT NULL DEFAULT '[]',
    "lateEntrySlabs" JSONB NOT NULL DEFAULT '[]',
    "professionalTaxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "professionalTaxAmount" DECIMAL(10,2) NOT NULL DEFAULT 200,
    "components" JSONB NOT NULL DEFAULT '[]',
    "roundingRule" TEXT NOT NULL DEFAULT 'ROUND',
    "decimalPrecision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "runCode" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "employeeCategory" TEXT NOT NULL DEFAULT 'ALL',
    "calendarDays" INTEGER NOT NULL DEFAULT 31,
    "totalEmployees" INTEGER NOT NULL DEFAULT 0,
    "totalGross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalNetSalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalPfEmployee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalPfEmployer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalEsiEmployee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalEsiEmployer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "lockedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_results" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "payrollRunId" INTEGER NOT NULL,
    "employeeId" BIGINT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "salaryType" TEXT NOT NULL,
    "totalDays" INTEGER NOT NULL DEFAULT 0,
    "presentDays" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "absentDays" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lopDays" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "halfDays" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "dailyRate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "earnedSalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossSalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otPay" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pfWage" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employeePf" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employerPf" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employeeEsi" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employerEsi" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pfApplicable" BOOLEAN NOT NULL DEFAULT false,
    "esiApplicable" BOOLEAN NOT NULL DEFAULT false,
    "professionalTax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "permissionDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "salaryAdvance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "loanRecovery" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netSalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paymentMode" TEXT NOT NULL DEFAULT 'CASH',
    "hasVariance" BOOLEAN NOT NULL DEFAULT false,
    "varianceNote" TEXT,
    "lateEntryDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashInHand" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "payroll_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_advances" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "employeeId" BIGINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "disbursedDate" DATE NOT NULL,
    "reason" TEXT,
    "recoveredAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_permanent_deductions" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "employeeId" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_permanent_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "doc_type" VARCHAR(40) NOT NULL,
    "business_place_id" BIGINT,
    "fy_code" VARCHAR(10) NOT NULL DEFAULT '',
    "prefix" VARCHAR(20) NOT NULL DEFAULT '',
    "next" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 4,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_visits" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "agent_user_id" VARCHAR(36) NOT NULL,
    "customer_id" UUID NOT NULL,
    "route_id" UUID,
    "planned_date" DATE NOT NULL,
    "planned_time" VARCHAR(5),
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    "outcome" VARCHAR(20),
    "check_in_at" TIMESTAMPTZ(6),
    "check_out_at" TIMESTAMPTZ(6),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "mobile_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_collections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "receipt_no" VARCHAR(30) NOT NULL,
    "agent_user_id" VARCHAR(36) NOT NULL,
    "customer_id" UUID NOT NULL,
    "visit_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_mode" VARCHAR(20) NOT NULL,
    "reference_no" VARCHAR(100),
    "bank_name" VARCHAR(120),
    "cheque_date" DATE,
    "drawer_name" VARCHAR(160),
    "collected_at" TIMESTAMPTZ(6) NOT NULL,
    "notes" VARCHAR(1000),
    "allocations" JSONB NOT NULL DEFAULT '[]',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "voucher_ids" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'POSTED',
    "sync_error" VARCHAR(500),
    "device_id" VARCHAR(64),
    "app_version" VARCHAR(20),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "mobile_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_route_customers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "route_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "planned_time" VARCHAR(5),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "mobile_route_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_route_assignments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "route_id" UUID NOT NULL,
    "agent_user_id" VARCHAR(36) NOT NULL,
    "day_of_week" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_route_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_sync_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT current_setting('app.company_id')::uuid,
    "client_id" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "server_id" VARCHAR(64),
    "agent_user_id" VARCHAR(36) NOT NULL,
    "device_id" VARCHAR(64),
    "status" VARCHAR(20) NOT NULL DEFAULT 'OK',
    "error" VARCHAR(500),
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mobile_sync_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employees_departmentId_idx" ON "employees"("departmentId");

-- CreateIndex
CREATE INDEX "employees_roleId_idx" ON "employees"("roleId");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employees_shiftId_idx" ON "employees"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_empCode_key" ON "employees"("company_id", "empCode");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_email_key" ON "employees"("company_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_aadhaarNumber_key" ON "employees"("company_id", "aadhaarNumber");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_panNumber_key" ON "employees"("company_id", "panNumber");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_pfNumber_key" ON "employees"("company_id", "pfNumber");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_uanNumber_key" ON "employees"("company_id", "uanNumber");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_esiNumber_key" ON "employees"("company_id", "esiNumber");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeId_key" ON "users"("employeeId");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_employeeId_idx" ON "users"("employeeId");

-- CreateIndex
CREATE INDEX "users_roleId_idx" ON "users"("roleId");

-- CreateIndex
CREATE INDEX "users_company_id_idx" ON "users"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_sessionToken_key" ON "user_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "user_sessions_userId_isActive_idx" ON "user_sessions"("userId", "isActive");

-- CreateIndex
CREATE INDEX "user_sessions_adminId_isActive_idx" ON "user_sessions"("adminId", "isActive");

-- CreateIndex
CREATE INDEX "user_sessions_sessionToken_idx" ON "user_sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "login_attempts_username_idx" ON "login_attempts"("username");

-- CreateIndex
CREATE INDEX "login_attempts_ipAddress_idx" ON "login_attempts"("ipAddress");

-- CreateIndex
CREATE INDEX "login_attempts_attemptedAt_idx" ON "login_attempts"("attemptedAt");

-- CreateIndex
CREATE INDEX "login_attempts_userId_idx" ON "login_attempts"("userId");

-- CreateIndex
CREATE INDEX "audit_log_entityName_entityId_idx" ON "audit_log"("entityName", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_changedBy_idx" ON "audit_log"("changedBy");

-- CreateIndex
CREATE INDEX "audit_log_company_id_idx" ON "audit_log"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_company_id_code_key" ON "roles"("company_id", "code");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

-- CreateIndex
CREATE INDEX "role_permissions_company_id_idx" ON "role_permissions"("company_id");

-- CreateIndex
CREATE INDEX "departments_company_id_idx" ON "departments"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_types_company_id_name_key" ON "customer_types"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customer_grades_company_id_name_key" ON "customer_grades"("company_id", "name");

-- CreateIndex
CREATE INDEX "idx_cust_company_status" ON "customers"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customers_company_id_customerCode_key" ON "customers"("company_id", "customerCode");

-- CreateIndex
CREATE INDEX "customer_addresses_company_id_idx" ON "customer_addresses"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_companyCode_key" ON "companies"("companyCode");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_configs_company_id_key" ON "whatsapp_configs"("company_id");

-- CreateIndex
CREATE INDEX "email_configs_company_id_idx" ON "email_configs"("company_id");

-- CreateIndex
CREATE INDEX "business_places_company_id_idx" ON "business_places"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "routes_company_id_routeCode_key" ON "routes"("company_id", "routeCode");

-- CreateIndex
CREATE INDEX "SupplierMaterialPrice_supplierId_rawMaterialId_validFrom_va_idx" ON "SupplierMaterialPrice"("supplierId", "rawMaterialId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "SupplierMaterialPrice_company_id_idx" ON "SupplierMaterialPrice"("company_id");

-- CreateIndex
CREATE INDEX "suppliers_legal_name_idx" ON "suppliers"("legal_name");

-- CreateIndex
CREATE INDEX "suppliers_status_idx" ON "suppliers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_company_id_supplier_code_key" ON "suppliers"("company_id", "supplier_code");

-- CreateIndex
CREATE INDEX "supplier_addresses_company_id_idx" ON "supplier_addresses"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_shiftCode_key" ON "shifts"("shiftCode");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_company_id_shiftName_key" ON "shifts"("company_id", "shiftName");

-- CreateIndex
CREATE INDEX "product_images_productId_idx" ON "product_images"("productId");

-- CreateIndex
CREATE INDEX "product_images_company_id_idx" ON "product_images"("company_id");

-- CreateIndex
CREATE INDEX "products_uomId_idx" ON "products"("uomId");

-- CreateIndex
CREATE INDEX "products_productName_idx" ON "products"("productName");

-- CreateIndex
CREATE UNIQUE INDEX "products_company_id_productCode_key" ON "products"("company_id", "productCode");

-- CreateIndex
CREATE INDEX "sales_products_sales_product_name_idx" ON "sales_products"("sales_product_name");

-- CreateIndex
CREATE UNIQUE INDEX "sales_products_company_id_sales_product_code_key" ON "sales_products"("company_id", "sales_product_code");

-- CreateIndex
CREATE INDEX "sales_product_stocks_store_id_idx" ON "sales_product_stocks"("store_id");

-- CreateIndex
CREATE INDEX "sales_product_stocks_sales_product_id_idx" ON "sales_product_stocks"("sales_product_id");

-- CreateIndex
CREATE INDEX "sales_product_stocks_company_id_idx" ON "sales_product_stocks"("company_id");

-- CreateIndex
CREATE INDEX "sales_product_components_sales_product_id_idx" ON "sales_product_components"("sales_product_id");

-- CreateIndex
CREATE INDEX "sales_product_components_component_product_id_idx" ON "sales_product_components"("component_product_id");

-- CreateIndex
CREATE INDEX "sales_product_components_company_id_idx" ON "sales_product_components"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_product_components_sales_product_id_component_product_key" ON "sales_product_components"("sales_product_id", "component_product_id");

-- CreateIndex
CREATE INDEX "production_steps_product_id_idx" ON "production_steps"("product_id");

-- CreateIndex
CREATE INDEX "production_steps_company_id_idx" ON "production_steps"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_company_id_uomCode_key" ON "units_of_measure"("company_id", "uomCode");

-- CreateIndex
CREATE INDEX "locations_location_code_idx" ON "locations"("location_code");

-- CreateIndex
CREATE INDEX "locations_is_active_idx" ON "locations"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "locations_company_id_location_code_key" ON "locations"("company_id", "location_code");

-- CreateIndex
CREATE INDEX "machines_company_id_idx" ON "machines"("company_id");

-- CreateIndex
CREATE INDEX "stores_is_active_idx" ON "stores"("is_active");

-- CreateIndex
CREATE INDEX "stores_location_id_idx" ON "stores"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_company_id_store_code_key" ON "stores"("company_id", "store_code");

-- CreateIndex
CREATE UNIQUE INDEX "store_locations_company_id_store_id_location_code_key" ON "store_locations"("company_id", "store_id", "location_code");

-- CreateIndex
CREATE INDEX "raw_materials_store_id_idx" ON "raw_materials"("store_id");

-- CreateIndex
CREATE INDEX "raw_materials_location_id_idx" ON "raw_materials"("location_id");

-- CreateIndex
CREATE INDEX "raw_materials_is_active_idx" ON "raw_materials"("is_active");

-- CreateIndex
CREATE INDEX "raw_materials_company_id_idx" ON "raw_materials"("company_id");

-- CreateIndex
CREATE INDEX "bill_of_materials_product_id_idx" ON "bill_of_materials"("product_id");

-- CreateIndex
CREATE INDEX "bill_of_materials_raw_material_id_idx" ON "bill_of_materials"("raw_material_id");

-- CreateIndex
CREATE INDEX "bill_of_materials_company_id_idx" ON "bill_of_materials"("company_id");

-- CreateIndex
CREATE INDEX "finished_goods_stocks_store_id_idx" ON "finished_goods_stocks"("store_id");

-- CreateIndex
CREATE INDEX "finished_goods_stocks_product_item_id_idx" ON "finished_goods_stocks"("product_item_id");

-- CreateIndex
CREATE INDEX "finished_goods_stocks_company_id_idx" ON "finished_goods_stocks"("company_id");

-- CreateIndex
CREATE INDEX "finished_goods_transactions_txn_date_time_idx" ON "finished_goods_transactions"("txn_date_time");

-- CreateIndex
CREATE INDEX "finished_goods_transactions_store_id_idx" ON "finished_goods_transactions"("store_id");

-- CreateIndex
CREATE INDEX "finished_goods_transactions_product_item_id_idx" ON "finished_goods_transactions"("product_item_id");

-- CreateIndex
CREATE INDEX "finished_goods_transactions_txn_type_idx" ON "finished_goods_transactions"("txn_type");

-- CreateIndex
CREATE INDEX "finished_goods_transactions_company_id_idx" ON "finished_goods_transactions"("company_id");

-- CreateIndex
CREATE INDEX "production_orders_order_date_idx" ON "production_orders"("order_date");

-- CreateIndex
CREATE INDEX "production_orders_due_date_idx" ON "production_orders"("due_date");

-- CreateIndex
CREATE INDEX "production_orders_product_item_id_idx" ON "production_orders"("product_item_id");

-- CreateIndex
CREATE INDEX "production_orders_status_idx" ON "production_orders"("status");

-- CreateIndex
CREATE INDEX "production_orders_company_id_idx" ON "production_orders"("company_id");

-- CreateIndex
CREATE INDEX "goods_dispatches_status_idx" ON "goods_dispatches"("status");

-- CreateIndex
CREATE INDEX "goods_dispatches_dispatch_date_idx" ON "goods_dispatches"("dispatch_date");

-- CreateIndex
CREATE UNIQUE INDEX "goods_dispatches_company_id_dispatch_number_key" ON "goods_dispatches"("company_id", "dispatch_number");

-- CreateIndex
CREATE INDEX "machine_operation_assignments_machine_id_idx" ON "machine_operation_assignments"("machine_id");

-- CreateIndex
CREATE INDEX "machine_operation_assignments_week_start_date_week_end_date_idx" ON "machine_operation_assignments"("week_start_date", "week_end_date");

-- CreateIndex
CREATE INDEX "machine_operation_assignments_incharge_employee_id_idx" ON "machine_operation_assignments"("incharge_employee_id");

-- CreateIndex
CREATE INDEX "machine_operation_assignments_company_id_idx" ON "machine_operation_assignments"("company_id");

-- CreateIndex
CREATE INDEX "machine_assignment_operators_assignment_id_idx" ON "machine_assignment_operators"("assignment_id");

-- CreateIndex
CREATE INDEX "machine_assignment_operators_employee_id_idx" ON "machine_assignment_operators"("employee_id");

-- CreateIndex
CREATE INDEX "machine_assignment_operators_company_id_idx" ON "machine_assignment_operators"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "machine_assignment_operators_assignment_id_employee_id_key" ON "machine_assignment_operators"("assignment_id", "employee_id");

-- CreateIndex
CREATE INDEX "goods_dispatch_items_dispatch_id_idx" ON "goods_dispatch_items"("dispatch_id");

-- CreateIndex
CREATE INDEX "goods_dispatch_items_production_order_id_idx" ON "goods_dispatch_items"("production_order_id");

-- CreateIndex
CREATE INDEX "goods_dispatch_items_company_id_idx" ON "goods_dispatch_items"("company_id");

-- CreateIndex
CREATE INDEX "weekly_machine_programs_production_order_id_idx" ON "weekly_machine_programs"("production_order_id");

-- CreateIndex
CREATE INDEX "weekly_machine_programs_machine_id_idx" ON "weekly_machine_programs"("machine_id");

-- CreateIndex
CREATE INDEX "weekly_machine_programs_shift_id_idx" ON "weekly_machine_programs"("shift_id");

-- CreateIndex
CREATE INDEX "weekly_machine_programs_week_start_date_idx" ON "weekly_machine_programs"("week_start_date");

-- CreateIndex
CREATE INDEX "weekly_machine_programs_status_idx" ON "weekly_machine_programs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_machine_programs_company_id_machine_id_shift_id_week_key" ON "weekly_machine_programs"("company_id", "machine_id", "shift_id", "week_start_date", "day_of_week", "sequence_no");

-- CreateIndex
CREATE INDEX "hourly_productions_production_order_id_idx" ON "hourly_productions"("production_order_id");

-- CreateIndex
CREATE INDEX "hourly_productions_machine_id_idx" ON "hourly_productions"("machine_id");

-- CreateIndex
CREATE INDEX "hourly_productions_shift_id_idx" ON "hourly_productions"("shift_id");

-- CreateIndex
CREATE INDEX "hourly_productions_daily_plan_id_idx" ON "hourly_productions"("daily_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "hourly_productions_company_id_production_date_machine_id_sh_key" ON "hourly_productions"("company_id", "production_date", "machine_id", "shift_id", "hour_index");

-- CreateIndex
CREATE INDEX "daily_production_plans_weekly_program_id_idx" ON "daily_production_plans"("weekly_program_id");

-- CreateIndex
CREATE INDEX "daily_production_plans_production_order_id_idx" ON "daily_production_plans"("production_order_id");

-- CreateIndex
CREATE INDEX "daily_production_plans_machine_id_idx" ON "daily_production_plans"("machine_id");

-- CreateIndex
CREATE INDEX "daily_production_plans_shift_id_idx" ON "daily_production_plans"("shift_id");

-- CreateIndex
CREATE INDEX "daily_production_plans_production_date_idx" ON "daily_production_plans"("production_date");

-- CreateIndex
CREATE INDEX "daily_production_plans_status_idx" ON "daily_production_plans"("status");

-- CreateIndex
CREATE INDEX "daily_production_plans_carry_forward_from_plan_id_idx" ON "daily_production_plans"("carry_forward_from_plan_id");

-- CreateIndex
CREATE INDEX "daily_production_plans_company_id_idx" ON "daily_production_plans"("company_id");

-- CreateIndex
CREATE INDEX "raw_material_transactions_store_id_idx" ON "raw_material_transactions"("store_id");

-- CreateIndex
CREATE INDEX "raw_material_transactions_raw_material_id_idx" ON "raw_material_transactions"("raw_material_id");

-- CreateIndex
CREATE INDEX "raw_material_transactions_txn_date_time_idx" ON "raw_material_transactions"("txn_date_time");

-- CreateIndex
CREATE INDEX "raw_material_transactions_production_order_id_idx" ON "raw_material_transactions"("production_order_id");

-- CreateIndex
CREATE INDEX "raw_material_transactions_company_id_idx" ON "raw_material_transactions"("company_id");

-- CreateIndex
CREATE INDEX "sales_orders_customerId_idx" ON "sales_orders"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_company_id_orderNo_key" ON "sales_orders"("company_id", "orderNo");

-- CreateIndex
CREATE INDEX "sales_order_items_salesOrderId_idx" ON "sales_order_items"("salesOrderId");

-- CreateIndex
CREATE INDEX "sales_order_items_productId_idx" ON "sales_order_items"("productId");

-- CreateIndex
CREATE INDEX "sales_order_items_sales_product_id_idx" ON "sales_order_items"("sales_product_id");

-- CreateIndex
CREATE INDEX "sales_order_items_company_id_idx" ON "sales_order_items"("company_id");

-- CreateIndex
CREATE INDEX "purchase_orders_supplierId_idx" ON "purchase_orders"("supplierId");

-- CreateIndex
CREATE INDEX "purchase_orders_company_id_idx" ON "purchase_orders"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_company_id_poNumber_key" ON "purchase_orders"("company_id", "poNumber");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchaseOrderId_idx" ON "purchase_order_items"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_order_items_company_id_idx" ON "purchase_order_items"("company_id");

-- CreateIndex
CREATE INDEX "grn_invoices_supplier_id_idx" ON "grn_invoices"("supplier_id");

-- CreateIndex
CREATE INDEX "grn_invoices_store_id_idx" ON "grn_invoices"("store_id");

-- CreateIndex
CREATE INDEX "grn_invoices_company_id_idx" ON "grn_invoices"("company_id");

-- CreateIndex
CREATE INDEX "grn_invoices_po_id_idx" ON "grn_invoices"("po_id");

-- CreateIndex
CREATE UNIQUE INDEX "grn_invoices_company_id_grn_number_key" ON "grn_invoices"("company_id", "grn_number");

-- CreateIndex
CREATE INDEX "grn_invoice_items_grn_invoice_id_idx" ON "grn_invoice_items"("grn_invoice_id");

-- CreateIndex
CREATE INDEX "grn_invoice_items_product_id_idx" ON "grn_invoice_items"("product_id");

-- CreateIndex
CREATE INDEX "grn_invoice_items_company_id_idx" ON "grn_invoice_items"("company_id");

-- CreateIndex
CREATE INDEX "grn_invoice_payments_grn_invoice_id_idx" ON "grn_invoice_payments"("grn_invoice_id");

-- CreateIndex
CREATE INDEX "grn_invoice_payments_company_id_idx" ON "grn_invoice_payments"("company_id");

-- CreateIndex
CREATE INDEX "production_wastages_production_order_id_idx" ON "production_wastages"("production_order_id");

-- CreateIndex
CREATE INDEX "production_wastages_hourly_production_id_idx" ON "production_wastages"("hourly_production_id");

-- CreateIndex
CREATE INDEX "production_wastages_machine_id_idx" ON "production_wastages"("machine_id");

-- CreateIndex
CREATE INDEX "production_wastages_shift_id_idx" ON "production_wastages"("shift_id");

-- CreateIndex
CREATE INDEX "production_wastages_product_id_idx" ON "production_wastages"("product_id");

-- CreateIndex
CREATE INDEX "production_wastages_wastage_date_idx" ON "production_wastages"("wastage_date");

-- CreateIndex
CREATE UNIQUE INDEX "production_wastages_company_id_wastage_no_key" ON "production_wastages"("company_id", "wastage_no");

-- CreateIndex
CREATE INDEX "stock_adjustments_adjustment_date_idx" ON "stock_adjustments"("adjustment_date");

-- CreateIndex
CREATE INDEX "stock_adjustments_status_idx" ON "stock_adjustments"("status");

-- CreateIndex
CREATE INDEX "stock_adjustments_adjustment_type_idx" ON "stock_adjustments"("adjustment_type");

-- CreateIndex
CREATE INDEX "stock_adjustments_production_order_id_idx" ON "stock_adjustments"("production_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_company_id_adjustment_number_key" ON "stock_adjustments"("company_id", "adjustment_number");

-- CreateIndex
CREATE INDEX "stock_adjustment_items_stock_adjustment_id_idx" ON "stock_adjustment_items"("stock_adjustment_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_items_store_id_idx" ON "stock_adjustment_items"("store_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_items_company_id_idx" ON "stock_adjustment_items"("company_id");

-- CreateIndex
CREATE INDEX "production_order_history_production_order_id_idx" ON "production_order_history"("production_order_id");

-- CreateIndex
CREATE INDEX "production_order_history_changed_at_idx" ON "production_order_history"("changed_at");

-- CreateIndex
CREATE INDEX "production_order_history_company_id_idx" ON "production_order_history"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_company_id_expenseNumber_key" ON "expenses"("company_id", "expenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_settings_company_id_key" ON "invoice_settings"("company_id");

-- CreateIndex
CREATE INDEX "sales_invoices_customer_id_idx" ON "sales_invoices"("customer_id");

-- CreateIndex
CREATE INDEX "sales_invoices_company_id_idx" ON "sales_invoices"("company_id");

-- CreateIndex
CREATE INDEX "sales_invoices_sales_order_id_idx" ON "sales_invoices"("sales_order_id");

-- CreateIndex
CREATE INDEX "sales_invoices_store_id_idx" ON "sales_invoices"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_company_id_invoice_no_key" ON "sales_invoices"("company_id", "invoice_no");

-- CreateIndex
CREATE INDEX "sales_invoice_items_sales_invoice_id_idx" ON "sales_invoice_items"("sales_invoice_id");

-- CreateIndex
CREATE INDEX "sales_invoice_items_product_id_idx" ON "sales_invoice_items"("product_id");

-- CreateIndex
CREATE INDEX "sales_invoice_items_company_id_idx" ON "sales_invoice_items"("company_id");

-- CreateIndex
CREATE INDEX "sales_invoice_payments_sales_invoice_id_idx" ON "sales_invoice_payments"("sales_invoice_id");

-- CreateIndex
CREATE INDEX "sales_invoice_payments_company_id_idx" ON "sales_invoice_payments"("company_id");

-- CreateIndex
CREATE INDEX "machine_oee_snapshots_machine_id_production_date_idx" ON "machine_oee_snapshots"("machine_id", "production_date");

-- CreateIndex
CREATE INDEX "machine_oee_snapshots_daily_plan_id_idx" ON "machine_oee_snapshots"("daily_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "machine_oee_snapshots_company_id_machine_id_production_date_key" ON "machine_oee_snapshots"("company_id", "machine_id", "production_date", "shift_id");

-- CreateIndex
CREATE INDEX "eod_stock_snapshots_snapshot_date_idx" ON "eod_stock_snapshots"("snapshot_date");

-- CreateIndex
CREATE INDEX "eod_stock_snapshots_category_idx" ON "eod_stock_snapshots"("category");

-- CreateIndex
CREATE INDEX "eod_stock_snapshots_store_id_idx" ON "eod_stock_snapshots"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "eod_stock_snapshots_company_id_category_item_id_store_id_sn_key" ON "eod_stock_snapshots"("company_id", "category", "item_id", "store_id", "snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_company_id_key_key" ON "system_settings"("company_id", "key");

-- CreateIndex
CREATE INDEX "product_shift_records_product_id_idx" ON "product_shift_records"("product_id");

-- CreateIndex
CREATE INDEX "product_shift_records_machine_id_idx" ON "product_shift_records"("machine_id");

-- CreateIndex
CREATE INDEX "product_shift_records_shift_id_idx" ON "product_shift_records"("shift_id");

-- CreateIndex
CREATE INDEX "product_shift_records_company_id_idx" ON "product_shift_records"("company_id");

-- CreateIndex
CREATE INDEX "product_capacity_history_product_id_idx" ON "product_capacity_history"("product_id");

-- CreateIndex
CREATE INDEX "product_capacity_history_machine_id_idx" ON "product_capacity_history"("machine_id");

-- CreateIndex
CREATE INDEX "product_capacity_history_company_id_idx" ON "product_capacity_history"("company_id");

-- CreateIndex
CREATE INDEX "categories_type_idx" ON "categories"("type");

-- CreateIndex
CREATE INDEX "categories_is_active_idx" ON "categories"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "categories_company_id_code_key" ON "categories"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "account_ledgers_customerId_key" ON "account_ledgers"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "account_ledgers_supplierId_key" ON "account_ledgers"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "account_ledgers_company_id_code_key" ON "account_ledgers"("company_id", "code");

-- CreateIndex
CREATE INDEX "vouchers_refDocType_refDocId_idx" ON "vouchers"("refDocType", "refDocId");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_company_id_refDocType_refDocId_key" ON "vouchers"("company_id", "refDocType", "refDocId");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_company_id_voucherNo_key" ON "vouchers"("company_id", "voucherNo");

-- CreateIndex
CREATE INDEX "journal_items_voucherId_idx" ON "journal_items"("voucherId");

-- CreateIndex
CREATE INDEX "journal_items_debitLedgerId_idx" ON "journal_items"("debitLedgerId");

-- CreateIndex
CREATE INDEX "journal_items_creditLedgerId_idx" ON "journal_items"("creditLedgerId");

-- CreateIndex
CREATE INDEX "journal_items_company_id_idx" ON "journal_items"("company_id");

-- CreateIndex
CREATE INDEX "sales_returns_customerId_idx" ON "sales_returns"("customerId");

-- CreateIndex
CREATE INDEX "sales_returns_company_id_idx" ON "sales_returns"("company_id");

-- CreateIndex
CREATE INDEX "sales_returns_salesInvoiceId_idx" ON "sales_returns"("salesInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_company_id_returnNo_key" ON "sales_returns"("company_id", "returnNo");

-- CreateIndex
CREATE INDEX "sales_return_items_salesReturnId_idx" ON "sales_return_items"("salesReturnId");

-- CreateIndex
CREATE INDEX "sales_return_items_productId_idx" ON "sales_return_items"("productId");

-- CreateIndex
CREATE INDEX "sales_return_items_salesInvoiceItemId_idx" ON "sales_return_items"("salesInvoiceItemId");

-- CreateIndex
CREATE INDEX "sales_return_items_company_id_idx" ON "sales_return_items"("company_id");

-- CreateIndex
CREATE INDEX "purchase_returns_supplierId_idx" ON "purchase_returns"("supplierId");

-- CreateIndex
CREATE INDEX "purchase_returns_company_id_idx" ON "purchase_returns"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_company_id_returnNo_key" ON "purchase_returns"("company_id", "returnNo");

-- CreateIndex
CREATE INDEX "purchase_return_items_purchaseReturnId_idx" ON "purchase_return_items"("purchaseReturnId");

-- CreateIndex
CREATE INDEX "purchase_return_items_company_id_idx" ON "purchase_return_items"("company_id");

-- CreateIndex
CREATE INDEX "petty_cash_entries_company_id_idx" ON "petty_cash_entries"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "petty_cash_entries_company_id_entryNo_key" ON "petty_cash_entries"("company_id", "entryNo");

-- CreateIndex
CREATE INDEX "accounting_periods_company_id_idx" ON "accounting_periods"("company_id");

-- CreateIndex
CREATE INDEX "attendance_records_company_id_idx" ON "attendance_records"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_employeeId_date_key" ON "attendance_records"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "employee_payroll_configs_employeeId_key" ON "employee_payroll_configs"("employeeId");

-- CreateIndex
CREATE INDEX "employee_payroll_configs_company_id_idx" ON "employee_payroll_configs"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_configs_company_id_key" ON "payroll_configs"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_company_id_runCode_key" ON "payroll_runs"("company_id", "runCode");

-- CreateIndex
CREATE INDEX "payroll_results_payrollRunId_idx" ON "payroll_results"("payrollRunId");

-- CreateIndex
CREATE INDEX "payroll_results_employeeId_idx" ON "payroll_results"("employeeId");

-- CreateIndex
CREATE INDEX "payroll_results_company_id_idx" ON "payroll_results"("company_id");

-- CreateIndex
CREATE INDEX "salary_advances_company_id_idx" ON "salary_advances"("company_id");

-- CreateIndex
CREATE INDEX "employee_permanent_deductions_company_id_idx" ON "employee_permanent_deductions"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_company_id_doc_type_business_place_id_fy_key" ON "document_sequences"("company_id", "doc_type", "business_place_id", "fy_code");

-- CreateIndex
CREATE INDEX "mobile_visits_company_id_agent_user_id_planned_date_idx" ON "mobile_visits"("company_id", "agent_user_id", "planned_date");

-- CreateIndex
CREATE INDEX "mobile_visits_company_id_customer_id_idx" ON "mobile_visits"("company_id", "customer_id");

-- CreateIndex
CREATE INDEX "mobile_visits_company_id_updated_at_idx" ON "mobile_visits"("company_id", "updated_at");

-- CreateIndex
CREATE INDEX "mobile_collections_company_id_agent_user_id_collected_at_idx" ON "mobile_collections"("company_id", "agent_user_id", "collected_at");

-- CreateIndex
CREATE INDEX "mobile_collections_company_id_customer_id_idx" ON "mobile_collections"("company_id", "customer_id");

-- CreateIndex
CREATE INDEX "mobile_collections_company_id_updated_at_idx" ON "mobile_collections"("company_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_collections_company_id_receipt_no_key" ON "mobile_collections"("company_id", "receipt_no");

-- CreateIndex
CREATE INDEX "mobile_route_customers_company_id_idx" ON "mobile_route_customers"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_route_customers_route_id_customer_id_key" ON "mobile_route_customers"("route_id", "customer_id");

-- CreateIndex
CREATE INDEX "mobile_route_assignments_company_id_agent_user_id_idx" ON "mobile_route_assignments"("company_id", "agent_user_id");

-- CreateIndex
CREATE INDEX "mobile_sync_records_company_id_agent_user_id_entity_type_idx" ON "mobile_sync_records"("company_id", "agent_user_id", "entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_sync_records_company_id_client_id_key" ON "mobile_sync_records"("company_id", "client_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("shiftCode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_changedByAdmin_fkey" FOREIGN KEY ("changedByAdmin") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "users"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_types" ADD CONSTRAINT "customer_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_grades" ADD CONSTRAINT "customer_grades_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_customerTypeId_fkey" FOREIGN KEY ("customerTypeId") REFERENCES "customer_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_customerGradeId_fkey" FOREIGN KEY ("customerGradeId") REFERENCES "customer_grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_configs" ADD CONSTRAINT "whatsapp_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_configs" ADD CONSTRAINT "email_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_places" ADD CONSTRAINT "business_places_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMaterialPrice" ADD CONSTRAINT "SupplierMaterialPrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMaterialPrice" ADD CONSTRAINT "SupplierMaterialPrice_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_addresses" ADD CONSTRAINT "supplier_addresses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_addresses" ADD CONSTRAINT "supplier_addresses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_products" ADD CONSTRAINT "sales_products_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_product_stocks" ADD CONSTRAINT "sales_product_stocks_sales_product_id_fkey" FOREIGN KEY ("sales_product_id") REFERENCES "sales_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_product_stocks" ADD CONSTRAINT "sales_product_stocks_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_product_stocks" ADD CONSTRAINT "sales_product_stocks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_product_components" ADD CONSTRAINT "sales_product_components_sales_product_id_fkey" FOREIGN KEY ("sales_product_id") REFERENCES "sales_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_product_components" ADD CONSTRAINT "sales_product_components_component_product_id_fkey" FOREIGN KEY ("component_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_product_components" ADD CONSTRAINT "sales_product_components_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_steps" ADD CONSTRAINT "production_steps_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_steps" ADD CONSTRAINT "production_steps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units_of_measure" ADD CONSTRAINT "units_of_measure_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_businessPlaceId_fkey" FOREIGN KEY ("businessPlaceId") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_businessPlaceId_fkey" FOREIGN KEY ("businessPlaceId") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_incharge_id_fkey" FOREIGN KEY ("incharge_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("location_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_locations" ADD CONSTRAINT "store_locations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "store_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_locations" ADD CONSTRAINT "store_locations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_locations" ADD CONSTRAINT "store_locations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "store_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_of_materials" ADD CONSTRAINT "bill_of_materials_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_of_materials" ADD CONSTRAINT "bill_of_materials_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("raw_material_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_of_materials" ADD CONSTRAINT "bill_of_materials_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_stocks" ADD CONSTRAINT "finished_goods_stocks_product_item_id_fkey" FOREIGN KEY ("product_item_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_stocks" ADD CONSTRAINT "finished_goods_stocks_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_stocks" ADD CONSTRAINT "finished_goods_stocks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_transactions" ADD CONSTRAINT "finished_goods_transactions_product_item_id_fkey" FOREIGN KEY ("product_item_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_transactions" ADD CONSTRAINT "finished_goods_transactions_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("production_order_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_transactions" ADD CONSTRAINT "finished_goods_transactions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_transactions" ADD CONSTRAINT "finished_goods_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_machineMachineId_fkey" FOREIGN KEY ("machineMachineId") REFERENCES "machines"("machine_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_product_item_id_fkey" FOREIGN KEY ("product_item_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_dispatches" ADD CONSTRAINT "goods_dispatches_destination_store_id_fkey" FOREIGN KEY ("destination_store_id") REFERENCES "stores"("store_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_dispatches" ADD CONSTRAINT "goods_dispatches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_operation_assignments" ADD CONSTRAINT "machine_operation_assignments_incharge_employee_id_fkey" FOREIGN KEY ("incharge_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_operation_assignments" ADD CONSTRAINT "machine_operation_assignments_incharge_role_id_fkey" FOREIGN KEY ("incharge_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_operation_assignments" ADD CONSTRAINT "machine_operation_assignments_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_operation_assignments" ADD CONSTRAINT "machine_operation_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("shiftCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_operation_assignments" ADD CONSTRAINT "machine_operation_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignment_operators" ADD CONSTRAINT "machine_assignment_operators_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "machine_operation_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignment_operators" ADD CONSTRAINT "machine_assignment_operators_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignment_operators" ADD CONSTRAINT "machine_assignment_operators_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignment_operators" ADD CONSTRAINT "machine_assignment_operators_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_dispatch_items" ADD CONSTRAINT "goods_dispatch_items_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "goods_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_dispatch_items" ADD CONSTRAINT "goods_dispatch_items_product_item_id_fkey" FOREIGN KEY ("product_item_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_dispatch_items" ADD CONSTRAINT "goods_dispatch_items_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("production_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_dispatch_items" ADD CONSTRAINT "goods_dispatch_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_machine_programs" ADD CONSTRAINT "weekly_machine_programs_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_machine_programs" ADD CONSTRAINT "weekly_machine_programs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_machine_programs" ADD CONSTRAINT "weekly_machine_programs_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("production_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_machine_programs" ADD CONSTRAINT "weekly_machine_programs_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("shiftCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_machine_programs" ADD CONSTRAINT "weekly_machine_programs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hourly_productions" ADD CONSTRAINT "hourly_productions_daily_plan_id_fkey" FOREIGN KEY ("daily_plan_id") REFERENCES "daily_production_plans"("daily_plan_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hourly_productions" ADD CONSTRAINT "hourly_productions_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hourly_productions" ADD CONSTRAINT "hourly_productions_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("production_order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hourly_productions" ADD CONSTRAINT "hourly_productions_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("shiftCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hourly_productions" ADD CONSTRAINT "hourly_productions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_production_plans" ADD CONSTRAINT "daily_production_plans_carry_forward_from_plan_id_fkey" FOREIGN KEY ("carry_forward_from_plan_id") REFERENCES "daily_production_plans"("daily_plan_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_production_plans" ADD CONSTRAINT "daily_production_plans_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_production_plans" ADD CONSTRAINT "daily_production_plans_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("production_order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_production_plans" ADD CONSTRAINT "daily_production_plans_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("shiftCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_production_plans" ADD CONSTRAINT "daily_production_plans_weekly_program_id_fkey" FOREIGN KEY ("weekly_program_id") REFERENCES "weekly_machine_programs"("weekly_program_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_production_plans" ADD CONSTRAINT "daily_production_plans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material_transactions" ADD CONSTRAINT "raw_material_transactions_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("production_order_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material_transactions" ADD CONSTRAINT "raw_material_transactions_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("raw_material_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material_transactions" ADD CONSTRAINT "raw_material_transactions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material_transactions" ADD CONSTRAINT "raw_material_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_source_employee_id_fkey" FOREIGN KEY ("source_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_referred_by_customer_id_fkey" FOREIGN KEY ("referred_by_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_sales_product_id_fkey" FOREIGN KEY ("sales_product_id") REFERENCES "sales_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_invoices" ADD CONSTRAINT "grn_invoices_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_invoices" ADD CONSTRAINT "grn_invoices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_invoices" ADD CONSTRAINT "grn_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_invoices" ADD CONSTRAINT "grn_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_invoice_items" ADD CONSTRAINT "grn_invoice_items_grn_invoice_id_fkey" FOREIGN KEY ("grn_invoice_id") REFERENCES "grn_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_invoice_items" ADD CONSTRAINT "grn_invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "raw_materials"("raw_material_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_invoice_items" ADD CONSTRAINT "grn_invoice_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_invoice_payments" ADD CONSTRAINT "grn_invoice_payments_grn_invoice_id_fkey" FOREIGN KEY ("grn_invoice_id") REFERENCES "grn_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_invoice_payments" ADD CONSTRAINT "grn_invoice_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_hourly_production_id_fkey" FOREIGN KEY ("hourly_production_id") REFERENCES "hourly_productions"("hourly_production_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("production_order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("raw_material_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("shiftCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_target_wastage_product_id_fkey" FOREIGN KEY ("target_wastage_product_id") REFERENCES "raw_materials"("raw_material_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("production_order_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_product_item_id_fkey" FOREIGN KEY ("product_item_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("raw_material_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_stock_adjustment_id_fkey" FOREIGN KEY ("stock_adjustment_id") REFERENCES "stock_adjustments"("adj_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_history" ADD CONSTRAINT "production_order_history_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("production_order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_history" ADD CONSTRAINT "production_order_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("store_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_payments" ADD CONSTRAINT "sales_invoice_payments_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_payments" ADD CONSTRAINT "sales_invoice_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_oee_snapshots" ADD CONSTRAINT "machine_oee_snapshots_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_oee_snapshots" ADD CONSTRAINT "machine_oee_snapshots_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eod_stock_snapshots" ADD CONSTRAINT "eod_stock_snapshots_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_shift_records" ADD CONSTRAINT "product_shift_records_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_shift_records" ADD CONSTRAINT "product_shift_records_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("production_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_shift_records" ADD CONSTRAINT "product_shift_records_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_shift_records" ADD CONSTRAINT "product_shift_records_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("shiftCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_shift_records" ADD CONSTRAINT "product_shift_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_capacity_history" ADD CONSTRAINT "product_capacity_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_capacity_history" ADD CONSTRAINT "product_capacity_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_ledgers" ADD CONSTRAINT "account_ledgers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_ledgers" ADD CONSTRAINT "account_ledgers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_ledgers" ADD CONSTRAINT "account_ledgers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_items" ADD CONSTRAINT "journal_items_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_items" ADD CONSTRAINT "journal_items_debitLedgerId_fkey" FOREIGN KEY ("debitLedgerId") REFERENCES "account_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_items" ADD CONSTRAINT "journal_items_creditLedgerId_fkey" FOREIGN KEY ("creditLedgerId") REFERENCES "account_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_items" ADD CONSTRAINT "journal_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_salesInvoiceItemId_fkey" FOREIGN KEY ("salesInvoiceItemId") REFERENCES "sales_invoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_grnInvoiceId_fkey" FOREIGN KEY ("grnInvoiceId") REFERENCES "grn_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("raw_material_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_entries" ADD CONSTRAINT "petty_cash_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payroll_configs" ADD CONSTRAINT "employee_payroll_configs_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payroll_configs" ADD CONSTRAINT "employee_payroll_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_configs" ADD CONSTRAINT "payroll_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_results" ADD CONSTRAINT "payroll_results_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_results" ADD CONSTRAINT "payroll_results_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_results" ADD CONSTRAINT "payroll_results_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_permanent_deductions" ADD CONSTRAINT "employee_permanent_deductions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_permanent_deductions" ADD CONSTRAINT "employee_permanent_deductions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_visits" ADD CONSTRAINT "mobile_visits_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_visits" ADD CONSTRAINT "mobile_visits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_visits" ADD CONSTRAINT "mobile_visits_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_collections" ADD CONSTRAINT "mobile_collections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_collections" ADD CONSTRAINT "mobile_collections_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_route_customers" ADD CONSTRAINT "mobile_route_customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_route_customers" ADD CONSTRAINT "mobile_route_customers_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_route_customers" ADD CONSTRAINT "mobile_route_customers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_route_assignments" ADD CONSTRAINT "mobile_route_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_route_assignments" ADD CONSTRAINT "mobile_route_assignments_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_sync_records" ADD CONSTRAINT "mobile_sync_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
