import React, { useState, useEffect, useCallback } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { useSelector } from "react-redux";
import {
  Building2,
  Eraser,
  MapPin,
  Percent,
  Plus,
  Save,
  ShieldCheck,
  Truck,
  Wallet,
} from "lucide-react";
import { ActionPill, Chip, PageHeader, SkeletonTile, Tile } from "../../../components/ui/v2";
import { FormFooter, KeyHint } from "../../sales/shared/tradeUi";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { z } from "zod";

import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import { useSuppliers } from "../../../hooks/useSuppliers";
import { supplierService } from "../../../services/supplierService";
import type { SupplierAddress } from "../../../features/supplier/types";

import IndiaPhoneInput, {
  type PhoneEntry,
  validatePhoneNumber,
} from "../../../components/ui/PhoneInput/PhoneInput";
import AddressForm from "../../../components/form/AddressFrom/AddressFrom";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import { useSocket } from "../../../providers/SocketProvider";
import { usePermission } from "../../../hooks/usePermission";
import { tdsService, type TdsSectionRow } from "../../../services/tdsService";

const supplierFormSchema = z.object({
  companyId: z.string().optional(),
  supplierCode: z
    .string()
    .trim()
    .min(1, "Supplier code is required")
    .max(20, "Maximum 20 characters allowed"),
  legalName: z
    .string()
    .trim()
    .min(1, "Legal name is required")
    .max(160, "Maximum 160 characters allowed"),
  displayName: z.string().trim().max(80, "Maximum 80 characters allowed").optional().nullable(),
  contactPerson: z.string().trim().max(80, "Maximum 80 characters allowed").optional().nullable(),
  mobile: z
    .string()
    .trim()
    .min(1, "Mobile number is required")
    .max(15, "Maximum 15 characters allowed"),
  email: z
    .preprocess(
      (val) => (val === "" ? null : val),
      z.string().trim().email("Invalid email address").max(120).nullable()
    )
    .optional(),
  gstin: z
    .preprocess(
      (val) => (typeof val === "string" ? val.trim().toUpperCase() : val),
      z
        .string()
        .refine(
          (val) => !val || /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(val),
          "Invalid GSTIN format (e.g. 33ABCDE1234F1Z5)"
        )
        .nullable()
    )
    .optional(),
  pan: z
    .preprocess(
      (val) => (typeof val === "string" ? val.trim().toUpperCase() : val),
      z
        .string()
        .refine(
          (val) => !val || /^[A-Z]{5}\d{4}[A-Z]$/.test(val),
          "Invalid PAN format (e.g. ABCDE1234F)"
        )
        .nullable()
    )
    .optional(),
  gstRegType: z.string().trim().max(20, "Maximum 20 characters allowed").optional().nullable(),
  billingAddressLine1: z.string().trim().min(1, "Address Line 1 is required"),
  billingAddressLine2: z.string().trim().optional().nullable(),
  billingAddressCity: z.string().trim().min(1, "City is required"),
  billingAddressState: z.string().trim().min(1, "State is required"),
  billingAddressPincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Pincode must be exactly 6 digits"),
  billingAddressCountry: z.string().optional().nullable().default("India"),
  addresses: z
    .array(
      z.object({
        address: z.object({
          addressLine1: z.string().trim().min(1, "Address Line 1 is required"),
          addressLine2: z.string().trim().optional().nullable(),
          city: z.string().trim().min(1, "City is required"),
          state: z.string().trim().min(1, "State is required"),
          pincode: z
            .string()
            .trim()
            .regex(/^\d{6}$/, "Pincode must be exactly 6 digits"),
        }),
      })
    )
    .min(1, "At least one delivery/plant address is required"),
  status: z.enum(["Active", "Backup", "Inactive", "Blacklisted"]),
});

const SupplierForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const location = useLocation();
  const { addSupplier, editSupplier, loading } = useSuppliers();
  const user = useSelector((state: any) => state.auth.user);
  const { socket } = useSocket();
  const { can } = usePermission();
  const canViewTds = can("tds.view");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [phones, setPhones] = useState<PhoneEntry[]>([]);
  const [initialSupplier, setInitialSupplier] = useState<any>(null);
  // P2-17: sections for the TDS default picker; skipped for a role without tds.view.
  const [tdsSections, setTdsSections] = useState<TdsSectionRow[]>([]);

  const [formData, setFormData] = useState({
    companyId: "",
    supplierCode: "",
    createdByOn: "",
    legalName: "",
    displayName: "",
    contactPerson: "",
    mobile: "",
    email: "",
    gstin: "",
    pan: "",
    gstRegType: "Registered",
    billingAddressLine1: "",
    billingAddressLine2: "",
    billingAddressCity: "",
    billingAddressState: "",
    billingAddressPincode: "",
    billingAddressCountry: "India",
    stateCode: "TN",
    openingBalance: 0,
    openingBalanceType: "CREDIT",
    creditDays: "",
    msmeCategory: "NOT_REGISTERED",
    udyamNumber: "",
    hasWrittenContract: false,
    agreedPaymentDays: "",
    // P2-17: the TDS section, deductee type and 206AB flag the GRN form's own preview defaults
    // from when the caller does not name them by hand.
    defaultTdsSectionCode: "",
    deducteeType: "",
    higherRate206AB: false,
    status: "Active",
  });

  const [addresses, setAddresses] = useState<SupplierAddress[]>([
    {
      address: {
        addressLine1: "",
        addressLine2: "",
        city: "",
        state: "",
        pincode: "",
      },
    },
  ]);

  const [errors, setErrors] = useState<Record<string, string>>({});

  useFormShortcuts({});

  const populateForm = (supplier: any) => {
    setInitialSupplier(supplier);
    setFormData({
      companyId: supplier.companyId || "",
      supplierCode: supplier.supplierCode || "",
      createdByOn: supplier.createdByUser?.fullName
        ? `${supplier.createdByUser.fullName}${supplier.createdAt ? " - " + new Date(supplier.createdAt).toLocaleString() : ""}`
        : "",
      legalName: supplier.legalName || "",
      displayName: supplier.displayName || "",
      contactPerson: supplier.contactPerson || "",
      mobile: supplier.mobile || "",
      email: supplier.email || "",
      gstin: supplier.gstin || "",
      pan: supplier.pan || "",
      gstRegType: supplier.gstRegType || "Registered",
      billingAddressLine1: supplier.billingAddressLine1 || "",
      billingAddressLine2: "",
      billingAddressCity: supplier.billingCity || "",
      billingAddressState: supplier.billingState || "",
      billingAddressPincode: supplier.billingPincode || "",
      billingAddressCountry: supplier.billingCountry || "India",
      stateCode: supplier.stateCode || "TN",
      openingBalance: Number(supplier.openingBalance) || 0,
      openingBalanceType: supplier.openingBalanceType || "CREDIT",
      creditDays: supplier.creditDays != null ? String(supplier.creditDays) : "",
      msmeCategory: supplier.msmeCategory ?? "NOT_REGISTERED",
      udyamNumber: supplier.udyamNumber ?? "",
      hasWrittenContract: Boolean(supplier.hasWrittenContract),
      agreedPaymentDays:
        supplier.agreedPaymentDays != null ? String(supplier.agreedPaymentDays) : "",
      defaultTdsSectionCode: supplier.defaultTdsSectionCode || "",
      deducteeType: supplier.deducteeType || "",
      higherRate206AB: Boolean(supplier.higherRate206AB),
      status: supplier.status || "Active",
    });

    if (supplier.addresses && supplier.addresses.length > 0) {
      setAddresses(supplier.addresses);
    } else {
      setAddresses([
        {
          address: {
            addressLine1: "",
            addressLine2: "",
            city: "",
            state: "",
            pincode: "",
          },
        },
      ]);
    }

    if (Array.isArray(supplier.mobile) && supplier.mobile.length > 0) {
      setPhones(supplier.mobile);
    } else if (supplier.phones && Array.isArray(supplier.phones) && supplier.phones.length > 0) {
      setPhones(supplier.phones);
    } else if (typeof supplier.mobile === "string" && supplier.mobile) {
      setPhones([{ label: "Mobile", number: supplier.mobile }]);
    } else {
      setPhones([]);
    }
  };

  useEffect(() => {
    const initForm = async () => {
      if (isEdit) {
        if (location.state) {
          populateForm(location.state);
        } else {
          try {
            setIsLoadingData(true);
            const supplier = await supplierService.fetchById(id!);
            populateForm(supplier);
          } catch (err) {
            toast.error("Failed to load supplier details.");
            navigate("/suppliers");
          } finally {
            setIsLoadingData(false);
          }
        }
      } else {
        try {
          const nextCode = await supplierService.fetchNextCode();
          if (nextCode) {
            setFormData((prev) => ({
              ...prev,
              supplierCode: nextCode,
              createdByOn: user?.username || "",
            }));
          }
        } catch (err) {
          console.error("Failed to fetch next code:", err);
        }
      }
    };

    initForm();
  }, [id, isEdit, location.state, user]);

  // TDS/TCS sections for the default-section picker (P2-17, P2-26): skipped for a role
  // without tds.view, so the section text input falls back when they lack the permission.
  useEffect(() => {
    if (!canViewTds) return;
    tdsService
      .sections()
      .then((rows) => setTdsSections(rows))
      .catch(() => {
        /* the picker just has nothing to offer */
      });
  }, [canViewTds]);

  useEffect(() => {
    if (!socket) return;

    // Realtime events carry only the id (F04): refetch the record through the REST API.
    const handleUpdated = (data: { id?: number | string }) => {
      if (isEdit && Number(data?.id) === Number(id)) {
        supplierService
          .fetchById(id!)
          .then((supplier) => populateForm(supplier))
          .catch(() => {
            /* keep what the form shows */
          });
      }
    };

    socket.on("supplier:updated", handleUpdated);
    return () => {
      socket.off("supplier:updated", handleUpdated);
    };
  }, [socket, isEdit, id]);

  const handleClear = () => {
    if (isEdit) {
      if (initialSupplier) {
        populateForm(initialSupplier);
      }
    } else {
      setFormData({
        companyId: "",
        supplierCode: "",
        createdByOn: user?.username || "",
        legalName: "",
        displayName: "",
        contactPerson: "",
        mobile: "",
        email: "",
        gstin: "",
        pan: "",
        gstRegType: "Registered",
        billingAddressLine1: "",
        billingAddressLine2: "",
        billingAddressCity: "",
        billingAddressState: "",
        billingAddressPincode: "",
        billingAddressCountry: "India",
        stateCode: "TN",
        openingBalance: 0,
        openingBalanceType: "CREDIT",
        creditDays: "",
        msmeCategory: "NOT_REGISTERED",
        udyamNumber: "",
        hasWrittenContract: false,
        agreedPaymentDays: "",
        defaultTdsSectionCode: "",
        deducteeType: "",
        higherRate206AB: false,
        status: "Active",
      });
      setAddresses([
        {
          address: {
            addressLine1: "",
            addressLine2: "",
            city: "",
            state: "",
            pincode: "",
          },
        },
      ]);
      setPhones([]);
      setErrors({});
      supplierService.fetchNextCode().then((nextCode) => {
        if (nextCode) {
          setFormData((prev) => ({ ...prev, supplierCode: nextCode }));
        }
      });
    }
  };

  const handleChange = (
    e:
      | React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
      | { target: { name: string; value: string } }
  ) => {
    const { name, value } = e.target;
    const type = (e.target as any).type;

    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({ ...prev, [name]: checked }));
    } else if (name === "gstin" || name === "pan") {
      const uppercaseVal = value.toUpperCase();
      setFormData((prev) => {
        const updated = { ...prev, [name]: uppercaseVal };
        if (name === "gstin" && uppercaseVal.length >= 12) {
          const extractedPan = uppercaseVal.slice(2, 12);
          if (/^[A-Z]{5}\d{4}[A-Z]$/.test(extractedPan)) {
            updated.pan = extractedPan;
            if (errors.pan) {
              setErrors((ePrev) => ({ ...ePrev, pan: "" }));
            }
          }
        }
        return updated;
      });
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const addShippingAddress = () => {
    setAddresses((prev) => [
      ...prev,
      {
        address: {
          addressLine1: "",
          addressLine2: "",
          city: "",
          state: "",
          pincode: "",
        },
      },
    ]);
  };

  const handleShippingAddressChange = (index: number, field: string, value: string) => {
    setAddresses((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        address: {
          ...updated[index].address,
          [field]: value,
        },
      };
      return updated;
    });

    const errorKey = `addresses.${index}.address.${field}`;
    if (errors[errorKey]) {
      setErrors((prev) => ({ ...prev, [errorKey]: "" }));
    }
  };

  const toggleSameAsBilling = (index: number, isSame: boolean) => {
    setAddresses((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        address: {
          ...updated[index].address,
          addressLine1: isSame ? formData.billingAddressLine1 : "",
          city: isSame ? formData.billingAddressCity : "",
          state: isSame ? formData.billingAddressState : "",
          pincode: isSame ? formData.billingAddressPincode : "",
        },
      };
      return updated;
    });

    if (isSame) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[`addresses.${index}.address.addressLine1`];
        delete newErrors[`addresses.${index}.address.city`];
        delete newErrors[`addresses.${index}.address.state`];
        delete newErrors[`addresses.${index}.address.pincode`];
        return newErrors;
      });
    }
  };

  const removeShippingAddress = (index: number) => {
    setAddresses((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    const primaryMobile = phones && phones.length > 0 ? phones[0].number : "";

    const dataToValidate = {
      ...formData,
      mobile: primaryMobile,
      addresses: addresses,
    };

    try {
      supplierFormSchema.parse(dataToValidate);
      setErrors({});
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors: Record<string, string> = {};
        error.issues.forEach((issue) => {
          const pathKey = issue.path.join(".");
          formattedErrors[pathKey] = issue.message;
        });
        setErrors(formattedErrors);
        toast.error("Please fill all required fields correctly.");
        setIsSubmitting(false);
        return;
      }
    }

    const payload: any = {
      companyId: formData.companyId,
      supplierCode: formData.supplierCode,
      legalName: formData.legalName,
      displayName: formData.displayName || null,
      contactPerson: formData.contactPerson || null,
      mobile: phones,
      email: formData.email || null,
      gstin: formData.gstin || null,
      pan: formData.pan || null,
      gstRegType: formData.gstRegType,
      billingAddressLine1: formData.billingAddressLine1,
      billingCity: formData.billingAddressCity,
      billingState: formData.billingAddressState,
      billingPincode: formData.billingAddressPincode,
      billingCountry: formData.billingAddressCountry || "India",
      stateCode: formData.stateCode,
      status: formData.status,
      addresses: addresses.map((addr) => {
        const copy = { ...addr };
        delete copy.id;
        return copy;
      }),
    };

    // P1-10: bills fall due this many days after the bill date (blank = due on the bill date).
    payload.creditDays =
      formData.creditDays === "" || formData.creditDays == null
        ? null
        : Number(formData.creditDays);
    // P1-07: MSME status drives the section 15 clock and the 43B(h) report. The agreed days are
    // sent as agreed; the 45-day cap is applied where the limit is worked out, not here, so the
    // record stays an honest account of what was signed.
    payload.msmeCategory = formData.msmeCategory || "NOT_REGISTERED";
    payload.udyamNumber = formData.udyamNumber?.trim()
      ? formData.udyamNumber.trim().toUpperCase()
      : null;
    payload.hasWrittenContract = Boolean(formData.hasWrittenContract);
    payload.agreedPaymentDays =
      formData.agreedPaymentDays === "" || formData.agreedPaymentDays == null
        ? null
        : Number(formData.agreedPaymentDays);
    // P2-17: TDS defaults the GRN form's own picker reads from this supplier.
    payload.defaultTdsSectionCode = formData.defaultTdsSectionCode?.trim()
      ? formData.defaultTdsSectionCode.trim().toUpperCase()
      : null;
    payload.deducteeType = formData.deducteeType || null;
    payload.higherRate206AB = Boolean(formData.higherRate206AB);

    if (!isEdit) {
      payload.openingBalance = Number(formData.openingBalance || 0);
      payload.openingBalanceType = formData.openingBalanceType || "CREDIT";
    }

    try {
      if (isEdit) {
        await editSupplier(id, payload);
        toast.success("Supplier updated successfully!");
      } else {
        await addSupplier(payload);
        toast.success("Supplier created successfully!");
      }
      navigate("/suppliers");
    } catch (err: any) {
      const apiErrors = err?.errors || err?.response?.data?.errors;
      if (Array.isArray(apiErrors) && apiErrors.length > 0) {
        const fieldErrors: Record<string, string> = {};
        apiErrors.forEach((item: any) => {
          let fieldName = (item.path || "").replace(/^body\./, "");
          if (fieldName === "billingPincode") fieldName = "billingAddressPincode";
          if (fieldName === "billingCity") fieldName = "billingAddressCity";
          if (fieldName === "billingState") fieldName = "billingAddressState";
          fieldErrors[fieldName] = item.message;
        });
        setErrors(fieldErrors);
        toast.error(apiErrors[0]?.message || "Validation failed.");
      } else {
        toast.error(err?.message || "Operation failed.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingData) {
    return (
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
        <SkeletonTile lines={4} label="Loading Supplier Details..." />
        <SkeletonTile lines={3} />
        <SkeletonTile lines={2} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <PageHeader
        title={isEdit ? "Edit Supplier" : "Add New Supplier"}
        meta={
          formData.supplierCode ? (
            <Chip size="sm" tone="muted">
              {formData.supplierCode}
            </Chip>
          ) : null
        }
        subtitle="Vendor master: GSTIN, addresses, credit terms, MSME status and TDS defaults."
        back={() => navigate(-1)}
        breadcrumbs={[{ label: "Suppliers", to: "/suppliers" }, { label: isEdit ? "Edit" : "New" }]}
      />

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Tile title="Supplier Details" icon={<Building2 size={18} />}>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
            <TextInput
              label="Supplier Code"
              name="supplierCode"
              value={formData.supplierCode}
              placeholder="SUP-001"
              required
              error={errors.supplierCode}
              onChange={handleChange}
              disabled
            />
            <TextInput
              label="Legal Name"
              name="legalName"
              value={formData.legalName}
              placeholder="Sri Vinayaga Chemicals Pvt Ltd"
              required
              error={errors.legalName}
              onChange={handleChange}
            />
            <TextInput
              label="Display Name"
              name="displayName"
              value={formData.displayName}
              placeholder="SVC"
              error={errors.displayName}
              onChange={handleChange}
            />
            <SelectInput
              label="Status"
              name="status"
              value={formData.status}
              options={[
                { value: "Active", label: "Active" },
                { value: "Backup", label: "Backup" },
                { value: "Inactive", label: "Inactive" },
                { value: "Blacklisted", label: "Blacklisted" },
              ]}
              error={errors.status}
              onChange={handleChange}
            />
            <TextInput
              label="Contact Person"
              name="contactPerson"
              value={formData.contactPerson}
              placeholder="Contact person name"
              error={errors.contactPerson}
              onChange={handleChange}
            />
            <TextInput
              label="Email"
              name="email"
              value={formData.email}
              placeholder="sales@svchemicals.com"
              error={errors.email}
              onChange={handleChange}
            />
            <TextInput
              label="GSTIN"
              name="gstin"
              value={formData.gstin}
              placeholder="33ABCDE1234F1Z5"
              error={errors.gstin}
              onChange={handleChange}
            />
            <TextInput
              label="PAN"
              name="pan"
              value={formData.pan}
              placeholder="ABCDE1234F"
              error={errors.pan}
              onChange={handleChange}
            />
          </div>
          <div className="mt-4 md:max-w-[50%]">
            <IndiaPhoneInput
              multi
              label="Mobile Numbers"
              name="phones"
              value={phones}
              onChange={(e) => {
                setPhones(e.target.value);
                if (errors.mobile) setErrors((prev) => ({ ...prev, mobile: "" }));
              }}
              maxNumbers={5}
              error={errors.mobile}
            />
          </div>
        </Tile>

        <Tile
          title="Billing Address"
          subtitle="Required. Its state decides the GST split on bills."
          icon={<MapPin size={18} />}
        >
          <AddressForm
            addressValue={formData.billingAddressLine1}
            onAddressChange={(v) =>
              handleChange({ target: { name: "billingAddressLine1", value: v } })
            }
            addressError={errors.billingAddressLine1}
            countryValue={formData.billingAddressCountry}
            onCountryChange={(v) => {
              setFormData((prev) => ({
                ...prev,
                billingAddressCountry: v,
                billingAddressState: "",
                billingAddressCity: "",
              }));
              setErrors((prev) => ({
                ...prev,
                billingAddressCountry: "",
                billingAddressState: "",
                billingAddressCity: "",
              }));
            }}
            countryError={errors.billingAddressCountry}
            stateValue={formData.billingAddressState}
            onStateChange={(v) => {
              setFormData((prev) => ({
                ...prev,
                billingAddressState: v,
                billingAddressCity: "",
              }));
              setErrors((prev) => ({
                ...prev,
                billingAddressState: "",
                billingAddressCity: "",
              }));
            }}
            stateError={errors.billingAddressState}
            cityValue={formData.billingAddressCity}
            onCityChange={(v) => {
              setFormData((prev) => ({ ...prev, billingAddressCity: v }));
              setErrors((prev) => ({ ...prev, billingAddressCity: "" }));
            }}
            cityError={errors.billingAddressCity}
            pincodeValue={formData.billingAddressPincode}
            onPincodeChange={(v) =>
              handleChange({ target: { name: "billingAddressPincode", value: v } })
            }
            pincodeError={errors.billingAddressPincode}
            required
          />
        </Tile>

        <Tile
          title="Delivery / Plant Addresses"
          subtitle="Where the supplier ships from; at least one is required."
          icon={<Truck size={18} />}
          actions={
            <ActionPill
              size="sm"
              variant="secondary"
              icon={<Plus size={15} />}
              onClick={addShippingAddress}
            >
              Add Address
            </ActionPill>
          }
        >
          <div className="space-y-4">
            {addresses.length === 0 && (
              <div className="rounded-[14px] border border-dashed border-line py-4 text-center text-sm text-ink-subtle">
                No addresses added.
              </div>
            )}
            {(() => {
              const isAnyAddressSameAsBilling = addresses.some(
                (addr) =>
                  addr.address.addressLine1 === formData.billingAddressLine1 &&
                  addr.address.city === formData.billingAddressCity &&
                  addr.address.state === formData.billingAddressState &&
                  addr.address.pincode === formData.billingAddressPincode &&
                  !!formData.billingAddressLine1
              );
              return addresses.map((addr, index) => {
                const isThisSameAsBilling =
                  addr.address.addressLine1 === formData.billingAddressLine1 &&
                  addr.address.city === formData.billingAddressCity &&
                  addr.address.state === formData.billingAddressState &&
                  addr.address.pincode === formData.billingAddressPincode &&
                  !!formData.billingAddressLine1;
                const showSameAsBillingCheckbox = isThisSameAsBilling || !isAnyAddressSameAsBilling;
                return (
                  <div
                    key={index}
                    className="rounded-[14px] border border-line-soft bg-card-2/60 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="sl-section-label m-0">Address {index + 1}</h3>
                      <div className="flex items-center gap-2">
                        {showSameAsBillingCheckbox && (
                          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-muted hover:text-ink">
                            <input
                              type="checkbox"
                              className="sl-check"
                              checked={isThisSameAsBilling}
                              onChange={(e) => toggleSameAsBilling(index, e.target.checked)}
                            />
                            Same as billing
                          </label>
                        )}
                        {addresses.length > 1 && (
                          <DeleteButton onClick={() => removeShippingAddress(index)} />
                        )}
                      </div>
                    </div>
                    <AddressForm
                      addressValue={addr.address.addressLine1}
                      onAddressChange={(v) => handleShippingAddressChange(index, "addressLine1", v)}
                      addressError={errors[`addresses.${index}.address.addressLine1`]}
                      stateValue={addr.address.state}
                      onStateChange={(v) => {
                        handleShippingAddressChange(index, "state", v);
                        handleShippingAddressChange(index, "city", "");
                      }}
                      stateError={errors[`addresses.${index}.address.state`]}
                      cityValue={addr.address.city}
                      onCityChange={(v) => handleShippingAddressChange(index, "city", v)}
                      cityError={errors[`addresses.${index}.address.city`]}
                      pincodeValue={addr.address.pincode}
                      onPincodeChange={(v) => handleShippingAddressChange(index, "pincode", v)}
                      pincodeError={errors[`addresses.${index}.address.pincode`]}
                      required
                    />
                  </div>
                );
              });
            })()}
          </div>
        </Tile>

        <Tile title="Payment terms" icon={<Wallet size={18} />}>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
            {!isEdit && (
              <>
                <div>
                  <TextInput
                    label="Opening Balance (₹)"
                    name="openingBalance"
                    type="number"
                    value={String(formData.openingBalance)}
                    placeholder="0.00"
                    error={errors.openingBalance}
                    onChange={handleChange}
                  />
                  <p className="sl-field-hint m-0 text-[color:var(--color-warning)]">
                    Set once. Cannot be edited later.
                  </p>
                </div>
                <SelectInput
                  label="Balance Type"
                  name="openingBalanceType"
                  value={formData.openingBalanceType}
                  options={[
                    { value: "CREDIT", label: "Credit (We owe supplier)" },
                    { value: "DEBIT", label: "Debit (Advance paid)" },
                  ]}
                  onChange={handleChange}
                />
              </>
            )}
            <div>
              <TextInput
                label="Credit Days"
                name="creditDays"
                type="number"
                value={String(formData.creditDays ?? "")}
                placeholder="e.g. 30"
                onChange={handleChange}
              />
              <p className="sl-field-hint m-0">
                Bills fall due this many days after the bill date.
              </p>
            </div>
          </div>
        </Tile>

        <Tile
          title="MSME Registration"
          subtitle="Drives the MSME dues clock under section 15 of the MSMED Act."
          icon={<ShieldCheck size={18} />}
        >
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <SelectInput
                label="MSME Category"
                name="msmeCategory"
                value={String(formData.msmeCategory ?? "NOT_REGISTERED")}
                options={[
                  { value: "NOT_REGISTERED", label: "Not registered" },
                  { value: "MICRO", label: "Micro" },
                  { value: "SMALL", label: "Small" },
                  { value: "MEDIUM", label: "Medium" },
                ]}
                onChange={handleChange}
              />
              <p className="sl-field-hint m-0">
                Micro and small carry the section 15 clock; medium does not.
              </p>
            </div>
            <div>
              <TextInput
                label="Udyam Number"
                name="udyamNumber"
                value={String(formData.udyamNumber ?? "")}
                placeholder="UDYAM-TN-01-0000001"
                onChange={handleChange}
              />
            </div>
            <div>
              <SelectInput
                label="Written Contract"
                name="hasWrittenContract"
                value={formData.hasWrittenContract ? "yes" : "no"}
                options={[
                  { value: "no", label: "No — 15-day limit" },
                  { value: "yes", label: "Yes — up to 45 days" },
                ]}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    hasWrittenContract: e.target.value === "yes",
                  }))
                }
              />
            </div>
            <div>
              <TextInput
                label="Agreed Payment Days"
                name="agreedPaymentDays"
                type="number"
                value={String(formData.agreedPaymentDays ?? "")}
                placeholder="e.g. 45"
                onChange={handleChange}
              />
              <p className="sl-field-hint m-0">
                Section 15 caps this at 45 days however long the contract says.
              </p>
            </div>
          </div>
        </Tile>

        <Tile title="TDS Defaults" icon={<Percent size={18} />}>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              {canViewTds ? (
                <SelectInput
                  label="Default TDS Section"
                  name="defaultTdsSectionCode"
                  value={String(formData.defaultTdsSectionCode ?? "")}
                  defaultOptionLabel="-- None --"
                  options={tdsSections
                    .filter((s) => !s.isTcs)
                    .map((s) => ({ value: s.code, label: `${s.code} — ${s.name}` }))}
                  onChange={handleChange}
                />
              ) : (
                <TextInput
                  label="Default TDS Section"
                  name="defaultTdsSectionCode"
                  value={formData.defaultTdsSectionCode}
                  placeholder="e.g. 194C(5)"
                  error={errors.defaultTdsSectionCode}
                  onChange={handleChange}
                />
              )}
              <p className="sl-field-hint m-0">
                The GRN form's TDS picker defaults to this section for this supplier.
              </p>
            </div>
            <div>
              <SelectInput
                label="Deductee Type"
                name="deducteeType"
                value={String(formData.deducteeType ?? "")}
                defaultOptionLabel="-- Not set --"
                options={[
                  { value: "COMPANY", label: "Company / Firm" },
                  { value: "INDIVIDUAL_HUF", label: "Individual / HUF" },
                  { value: "FIRM", label: "Firm" },
                  { value: "AOP_BOI", label: "AOP / BOI" },
                  { value: "LOCAL_AUTHORITY", label: "Local Authority" },
                  { value: "NON_RESIDENT", label: "Non-Resident" },
                ]}
                onChange={handleChange}
              />
            </div>
            <div>
              <SelectInput
                label="Higher Rate (206AB)"
                name="higherRate206AB"
                value={formData.higherRate206AB ? "yes" : "no"}
                options={[
                  { value: "no", label: "No" },
                  { value: "yes", label: "Yes — non-filer" },
                ]}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    higherRate206AB: e.target.value === "yes",
                  }))
                }
              />
              <p className="sl-field-hint m-0">
                Doubles the TDS rate when this supplier has not filed their returns.
              </p>
            </div>
          </div>
        </Tile>

        <FormFooter start={<KeyHint keys={["F2"]}>saves the supplier</KeyHint>}>
          <ActionPill variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </ActionPill>
          {!isEdit && (
            <ActionPill variant="secondary" icon={<Eraser size={16} />} onClick={handleClear}>
              Clear Form
            </ActionPill>
          )}
          <ActionPill
            type="submit"
            icon={<Save size={17} />}
            loading={isSubmitting}
            loadingText="Saving..."
            disabled={loading}
          >
            {isEdit ? "Update Supplier" : "Save Supplier"}
          </ActionPill>
        </FormFooter>
      </form>
    </div>
  );
};

export default SupplierForm;
