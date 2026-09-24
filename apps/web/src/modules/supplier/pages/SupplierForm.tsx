import React, { useState, useEffect, useCallback } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { useSelector } from "react-redux";
import { FaSave, FaEraser, FaPlus, FaTrash, FaArrowLeft, FaTimes } from "react-icons/fa";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { z } from "zod";

import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import CustomButton from "../../../components/ui/Button/Button";
import { useSuppliers } from "../../../hooks/useSuppliers";
import { supplierService } from "../../../services/supplierService";
import type { SupplierAddress } from "../../../features/supplier/types";

import IndiaPhoneInput, {
  type PhoneEntry,
  validatePhoneNumber,
} from "../../../components/ui/PhoneInput/PhoneInput";
import AddressForm from "../../../components/form/AddressFrom/AddressFrom";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import BackButton from "../../../components/ui/BackButton/BackButton";
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

    const handleUpdated = (data: any) => {
      if (isEdit && data.id === Number(id)) {
        populateForm(data);
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg font-semibold text-ink-subtle animate-pulse">
          Loading Supplier Details...
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1200px] mr-auto supplier-form-compact">
      <style>{`
                .supplier-form-compact label { margin-bottom: 2px !important; font-size: 11px !important; }
                .supplier-form-compact input, .supplier-form-compact select,
                .supplier-form-compact button[role="combobox"] { height: 32px !important; min-height: 32px !important; font-size: 12px !important; padding-top: 0 !important; padding-bottom: 0 !important; }
                .supplier-form-compact .group { margin-bottom: 0 !important; }
            `}</style>
      <div className="bg-card rounded-sm border border-line-soft overflow-visible">
        {/* Header */}
        <div className="px-5 py-3 border-b border-line-soft flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">
            {isEdit ? "Edit Supplier" : "Add New Supplier"}
          </h2>
          <BackButton text="Back" />
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="px-5 py-3 space-y-3">
            {/* ── Section 1: Supplier Details ── */}
            <div>
              <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-line-soft">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wide">
                  Supplier Details
                </h3>
              </div>
              <div className="grid grid-cols-4 gap-x-4 gap-y-1.5">
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
              <div className="mt-1.5 max-w-[50%]">
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
            </div>

            {/* ── Section 2: Billing Address ── */}
            <div>
              <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-line-soft">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wide">
                  Billing Address <span className="text-[color:var(--color-danger)]">*</span>
                </h3>
              </div>
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
            </div>

            {/* ── Section 3: Delivery / Plant Addresses ── */}
            <div>
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-line-soft">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wide">
                  Delivery / Plant Addresses{" "}
                  <span className="text-[color:var(--color-danger)]">*</span>
                </h3>
                <CustomButton
                  text="Add Address"
                  icon={FaPlus}
                  onClick={addShippingAddress}
                  type="button"
                  size="sm"
                  variant="secondary"
                />
              </div>
              <div className="space-y-2">
                {addresses.length === 0 && (
                  <div className="text-center text-[11px] text-ink-subtle py-2 border border-dashed border-line-soft rounded-lg bg-card-2">
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
                    const showSameAsBillingCheckbox =
                      isThisSameAsBilling || !isAnyAddressSameAsBilling;
                    return (
                      <div
                        key={index}
                        className="p-2.5 border border-line-soft rounded-lg bg-card-2"
                      >
                        <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-line-soft">
                          <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">
                            Address {index + 1}
                          </span>
                          <div className="flex items-center gap-2">
                            {showSameAsBillingCheckbox && (
                              <label className="flex items-center gap-1 text-[10px] text-ink-subtle cursor-pointer hover:text-ink">
                                <input
                                  type="checkbox"
                                  className="w-3 h-3 rounded accent-primary cursor-pointer"
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
                          onAddressChange={(v) =>
                            handleShippingAddressChange(index, "addressLine1", v)
                          }
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
            </div>

            {/* ── Section 4: Opening Balance — create mode only ── */}
            {!isEdit && (
              <div>
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-line-soft">
                  <h3 className="text-xs font-bold text-ink uppercase tracking-wide">
                    Opening Balance
                  </h3>
                </div>
                <div className="grid grid-cols-4 gap-x-4 gap-y-1.5">
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
                    <p className="mt-0.5 text-[10px] text-[color:var(--color-warning)]">
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
                </div>
              </div>
            )}
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wide">Credit Terms</h3>
              </div>
              <div className="grid grid-cols-4 gap-x-4 gap-y-1.5">
                <div>
                  <TextInput
                    label="Credit Days"
                    name="creditDays"
                    type="number"
                    value={String(formData.creditDays ?? "")}
                    placeholder="e.g. 30"
                    onChange={handleChange}
                  />
                  <p className="mt-0.5 text-[10px] text-ink-muted">
                    Bills fall due this many days after the bill date.
                  </p>
                </div>
              </div>
            </div>
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wide">
                  MSME Registration
                </h3>
              </div>
              <div className="grid grid-cols-4 gap-x-4 gap-y-1.5">
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
                  <p className="mt-0.5 text-[10px] text-ink-muted">
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
                  <p className="mt-0.5 text-[10px] text-ink-muted">
                    Section 15 caps this at 45 days however long the contract says.
                  </p>
                </div>
              </div>
            </div>
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wide">TDS Defaults</h3>
              </div>
              <div className="grid grid-cols-4 gap-x-4 gap-y-1.5">
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
                  <p className="mt-0.5 text-[10px] text-ink-muted">
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
                  <p className="mt-0.5 text-[10px] text-ink-muted">
                    Doubles the TDS rate when this supplier has not filed their returns.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-5 py-2.5 border-t border-line-soft bg-card-2">
            {!isEdit && (
              <CustomButton
                text="Clear Form"
                icon={FaEraser}
                onClick={handleClear}
                type="button"
                variant="secondary"
              />
            )}
            <CustomButton
              text={isSubmitting ? "Saving..." : isEdit ? "Update Supplier" : "Save Supplier"}
              icon={FaSave}
              type="submit"
              disabled={isSubmitting || loading}
            />
          </div>
        </form>
      </div>
    </div>
  );
};

export default SupplierForm;
