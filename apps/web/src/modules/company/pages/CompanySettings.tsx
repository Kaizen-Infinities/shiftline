import React, { useState, useEffect } from "react";
import { FaSave, FaInfoCircle, FaMapMarkerAlt, FaPhoneAlt } from "react-icons/fa";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useDispatch, useSelector } from "react-redux";
import TextInput from "../../../components/form/TextInput/TextInput";
import ImageUpload from "../../../components/form/ImageUpload/ImageUpload";
import Button from "../../../components/ui/Button/Button";
// import BackButton from "../../../components/ui/BackButton/BackButton";
import CityStateSelect from "../../../components/ui/CityStateSelect/CityStateSelect";
import IndiaPhoneInput from "../../../components/ui/PhoneInput/PhoneInput";
import type { RootState, AppDispatch } from "../../../app/store";
import { usePermission } from "../../../hooks/usePermission";
import CommonLoader from "../../../components/ui/Loader/CommonLoader";
import ThemeToggle from "../../../components/common/ThemeToggle";
import { fetchCompany, updateCompany } from "../../../features/company/companySlice";
import type { UpdateCompanyDto } from "../../../features/company/types";
import { validatePhoneEntries } from "../../../components/ui/PhoneInput/PhoneInput";
import { GST_STATES } from "@shiftline/shared";
import { Building2, Info, MapPin, Phone, Save } from "lucide-react";
import { ActionPill, Chip, PageHeader, Tile } from "../../../components/ui/v2";

const CompanySettings: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { can } = usePermission();
  const canEdit = can("company-settings.edit");
  const { data: company, loading } = useSelector((state: RootState) => state.company);

  const [phones, setPhones] = useState<any[]>([]);

  const isEditMode =
    location.pathname.includes("edit") ||
    location.pathname.includes("settings") ||
    !!(company && company.isOnboarded);

  const [formData, setFormData] = useState<UpdateCompanyDto>({});
  const [errors, setErrors] = useState<any>({});

  useEffect(() => {
    dispatch(fetchCompany());
  }, [dispatch]);

  useEffect(() => {
    if (company) {
      let parsedPhones = [];
      try {
        parsedPhones = company.mobile ? JSON.parse(company.mobile) : [];
      } catch {
        parsedPhones = [];
      }
      setPhones(Array.isArray(parsedPhones) ? parsedPhones : []);

      setFormData({
        companyCode: company.companyCode || `CMP-${Math.floor(10000 + Math.random() * 90000)}`,
        legalName: company.legalName || company.companyName || "",
        shortName: company.shortName || "",
        gstin: company.gstin || "",
        currencyCode: company.currencyCode || "INR",
        phone: company.phone || "",
        mobile: company.mobile || "",
        email: company.email || "",
        website: company.website || "",
        logoUrl: company.logoUrl || "",
        faviconUrl: company.faviconUrl || "",
        addressLine1: company.addressLine1 || "",
        city: company.city || "",
        state: company.state || "",
        zipcode: company.zipcode || "",
        country: company.country || "India",
        isActive: company.isActive,
        businessPlaces: (company.businessPlaces ?? []).map((bp) => ({ ...bp })),
      });
    }
  }, [company]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    let val: any = value;
    if (type === "checkbox") {
      val = (e.target as HTMLInputElement).checked;
    } else if (type === "file") {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        setFormData((prev) => ({ ...prev, [name]: file }));
        if (errors[name]) {
          setErrors((prev: any) => ({ ...prev, [name]: undefined }));
        }
      }
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: val }));
    if (errors[name]) {
      setErrors((prev: any) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleCountryChange = (countryData: any) => {
    setFormData((prev) => ({ ...prev, country: countryData.name, state: "", city: "" }));
    setErrors((prev: any) => ({ ...prev, country: undefined, state: undefined, city: undefined }));
  };

  const handleStateChange = (stateData: any) => {
    setFormData((prev) => ({ ...prev, state: stateData.name, city: "" }));
    setErrors((prev: any) => ({ ...prev, state: undefined, city: undefined }));
  };

  const handleCityChange = (cityData: any) => {
    setFormData((prev) => ({ ...prev, city: cityData.name }));
    setErrors((prev: any) => ({ ...prev, city: undefined }));
  };

  const validate = (): boolean => {
    const newErrors: any = {};
    if (!formData.companyCode?.trim()) newErrors.companyCode = "Company code is required";
    if (!formData.legalName?.trim()) newErrors.legalName = "Legal name is required";
    if (!formData.email?.trim()) newErrors.email = "Email is required";
    if (!formData.addressLine1?.trim()) newErrors.addressLine1 = "Address Line 1 is required";
    if (!formData.city?.trim()) newErrors.city = "City is required";
    if (!formData.state?.trim()) newErrors.state = "State is required";
    if (!formData.zipcode?.trim()) newErrors.zipcode = "Zipcode is required";
    if (!formData.country?.trim()) newErrors.country = "Country is required";

    const phoneErr = validatePhoneEntries(phones, false);
    if (phoneErr) newErrors.mobile = phoneErr;

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast.error("You do not have permission to edit company settings.");
      return;
    }
    if (!validate() || !company) return;

    try {
      const submitData = new FormData();
      Object.entries(formData).forEach(([key, value]) => {
        if (key === "logoFile") {
          if (value) {
            submitData.append("logo", value);
          }
        } else if (key === "faviconFile") {
          if (value) {
            submitData.append("favicon", value);
          }
        } else if (key === "businessPlaces") {
          submitData.append(key, JSON.stringify(value));
        } else if (key === "mobile") {
          submitData.append(key, JSON.stringify(phones));
        } else if (value !== undefined && value !== null) {
          submitData.append(key, String(value));
        }
      });

      await dispatch(updateCompany({ id: company.id, data: submitData as any })).unwrap();
      toast.success(
        company.isOnboarded ? "Company updated successfully!" : "Onboarding completed successfully!"
      );
      if (!company.isOnboarded) {
        navigate("/dashboard");
      } else {
        navigate("/company/view");
      }
    } catch (err: any) {
      toast.error(err?.message || err || "Failed to update company");
    }
  };

  if (loading && !company)
    return <CommonLoader text="Loading Company Settings..." fullScreen={false} />;

  // Onboarding Screen Design
  if (company && !company.isOnboarded) {
    return (
      <div className="fixed inset-0 z-9999 bg-page text-ink flex justify-center items-start overflow-y-auto min-h-screen py-10 px-4">
        <div className="absolute top-4 right-6 z-10">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-[1920px] mx-auto px-3 sm:px-4 md:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-ink pb-2">Welcome to Shiftline</h2>
            <p className="text-ink-muted">
              Please complete your company onboarding to get started.
            </p>
          </div>
          <div className="bg-card rounded-sm border border-line-soft">
            <form onSubmit={handleSubmit} noValidate>
              <div className="flex flex-col lg:flex-row min-h-[calc(100vh-270px)]">
                {/* Left: All Input Fields — 70% */}
                <div className="lg:w-[70%] px-6 py-6 space-y-8">
                  {/* General Info */}
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <FaInfoCircle className="text-primary text-xl" />
                      <h6 className="text-lg font-semibold text-ink m-0">General Info</h6>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <TextInput
                        label="Legal Company Name"
                        name="legalName"
                        value={formData.legalName || ""}
                        onChange={handleChange}
                        placeholder="Enter Legal Name"
                        required
                        error={errors.legalName}
                      />
                      <TextInput
                        label="GSTIN"
                        name="gstin"
                        value={formData.gstin || ""}
                        onChange={handleChange}
                        placeholder="Enter GSTIN"
                      />
                    </div>
                    <div className="hidden">
                      <TextInput
                        label="Company Code (Auto Generated)"
                        name="companyCode"
                        value={formData.companyCode || ""}
                        onChange={handleChange}
                        placeholder="Auto Generated"
                        disabled
                        error={errors.companyCode}
                      />
                    </div>
                  </div>

                  {/* Address Details */}
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <FaMapMarkerAlt className="text-primary text-xl" />
                      <h6 className="text-lg font-semibold text-ink m-0">Address Details</h6>
                    </div>
                    <div className="space-y-4">
                      <TextInput
                        label="Address"
                        name="addressLine1"
                        value={formData.addressLine1 || ""}
                        onChange={handleChange}
                        placeholder="Enter full address"
                        required
                        error={errors.addressLine1}
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="lg:col-span-3">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <CityStateSelect
                              countryLabel="Country"
                              countryValue={formData.country || "India"}
                              onCountryChange={handleCountryChange}
                              countryError={errors.country}
                              stateLabel="State"
                              stateValue={formData.state || ""}
                              onStateChange={handleStateChange}
                              stateError={errors.state}
                              cityLabel="City"
                              cityValue={formData.city || ""}
                              onCityChange={handleCityChange}
                              cityError={errors.city}
                              required
                            />
                          </div>
                        </div>
                        <TextInput
                          label="Zipcode"
                          name="zipcode"
                          value={formData.zipcode || ""}
                          onChange={handleChange}
                          placeholder="Enter Zipcode"
                          required
                          error={errors.zipcode}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Contact Details */}
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <FaPhoneAlt className="text-primary text-xl" />
                      <h6 className="text-lg font-semibold text-ink m-0">Contact Details</h6>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <TextInput
                        label="Email Address"
                        name="email"
                        type="email"
                        value={formData.email || ""}
                        onChange={handleChange}
                        placeholder="Enter Email"
                        required
                        error={errors.email}
                      />
                      <IndiaPhoneInput
                        multi
                        label="Mobile Numbers"
                        name="phones"
                        value={phones}
                        onChange={(e: any) => {
                          setPhones(e.target.value);
                          if (errors.mobile) {
                            setErrors((prev: any) => ({ ...prev, mobile: undefined }));
                          }
                        }}
                        maxNumbers={5}
                        error={errors.mobile}
                      />
                    </div>
                  </div>
                </div>

                {/* Right: Image Uploads — 30% */}
                <div className="lg:w-[30%] lg:border-l border-t lg:border-t-0 border-line-soft/50 px-6 py-6 flex lg:flex-col items-center justify-evenly">
                  <ImageUpload
                    label="Company Logo"
                    name="logoFile"
                    currentImageUrl={formData.logoUrl || undefined}
                    onChange={handleChange as any}
                  />
                  <ImageUpload
                    label="Favicon"
                    name="faviconFile"
                    currentImageUrl={formData.faviconUrl || undefined}
                    onChange={handleChange as any}
                  />
                </div>
              </div>

              <div className="flex justify-end px-6 py-5 border-t border-line-soft">
                <Button
                  text="Complete Onboarding"
                  icon={FaSave}
                  type="submit"
                  disabled={loading}
                  className="py-3 px-8 text-lg"
                />
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Normal Settings/Edit Screen Design
  return (
    <div className="sl-page sl-page-form">
      <PageHeader
        title="Company settings"
        icon={<Building2 size={22} />}
        subtitle="The legal identity, places of business, contact and address that print on every document."
        meta={
          formData.gstin ? (
            <Chip size="sm" className="font-mono">
              GSTIN {formData.gstin}
            </Chip>
          ) : undefined
        }
      />
      <form onSubmit={handleSubmit} noValidate>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-5">
            <Tile title="General Info" icon={<Info size={18} />}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextInput
                  label="Legal Name"
                  name="legalName"
                  value={formData.legalName || ""}
                  onChange={handleChange}
                  placeholder="Enter Legal Name"
                  required
                  error={errors.legalName}
                />
                <TextInput
                  label="Email"
                  name="email"
                  type="email"
                  value={formData.email || ""}
                  onChange={handleChange}
                  placeholder="Enter Email"
                  required
                  error={errors.email}
                />
                <TextInput
                  label="GSTIN"
                  name="gstin"
                  value={formData.gstin || ""}
                  onChange={handleChange}
                  placeholder="Enter GSTIN"
                />
              </div>
            </Tile>

            {/* Places of business (P1-08): GST state per place, GSTIN for separately registered branches */}
            {(formData.businessPlaces ?? []).length > 0 && (
              <Tile
                title="Places of business"
                icon={<MapPin size={18} />}
                subtitle="Documents are numbered per place and taxed from its GST state. A branch registered on its own carries its GSTIN; the head office bills under the company GSTIN above."
              >
                <div className="overflow-x-auto rounded-[14px] border border-line-soft">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-card-2">
                      <tr>
                        <th className="sl-th px-3 py-2.5">Code</th>
                        <th className="sl-th px-3 py-2.5">Name</th>
                        <th className="sl-th px-3 py-2.5">Type</th>
                        <th className="sl-th px-3 py-2.5">GST state</th>
                        <th className="sl-th px-3 py-2.5">GSTIN</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-soft">
                      {(formData.businessPlaces ?? []).map((bp, idx) => {
                        const updatePlace = (patch: Record<string, unknown>) =>
                          setFormData((prev) => ({
                            ...prev,
                            businessPlaces: (prev.businessPlaces ?? []).map((p, i) =>
                              i === idx ? { ...p, ...patch } : p
                            ),
                          }));
                        return (
                          <tr key={String(bp.id ?? idx)}>
                            <td className="px-3 py-2 font-mono font-semibold text-ink">
                              {bp.code}
                            </td>
                            <td className="px-3 py-2 text-ink">
                              {bp.name}
                              {bp.isHeadOffice && (
                                <Chip size="sm" className="ml-2">
                                  Head office
                                </Chip>
                              )}
                            </td>
                            <td className="px-3 py-2 text-ink-muted">
                              {String(bp.type ?? "")
                                .replace("_", " ")
                                .toLowerCase()}
                            </td>
                            <td className="px-3 py-2">
                              <select
                                className="sl-input h-9 py-0 text-xs"
                                value={bp.gstPlaceCode ?? ""}
                                onChange={(e) => updatePlace({ gstPlaceCode: e.target.value })}
                                disabled={!canEdit}
                                aria-label={`${bp.code} GST state`}
                              >
                                <option value="">Select</option>
                                {GST_STATES.map((st) => (
                                  <option key={st.code} value={st.code}>
                                    {st.code} · {st.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                className="sl-input h-9 py-0 font-mono text-xs uppercase disabled:opacity-60"
                                value={bp.isHeadOffice ? formData.gstin || "" : (bp.gstin ?? "")}
                                onChange={(e) => {
                                  const v = e.target.value
                                    .toUpperCase()
                                    .replace(/[^0-9A-Z]/g, "")
                                    .slice(0, 15);
                                  updatePlace({
                                    gstin: v || null,
                                    ...(v.length >= 2 ? { gstPlaceCode: v.slice(0, 2) } : {}),
                                  });
                                }}
                                maxLength={15}
                                disabled={!canEdit || Boolean(bp.isHeadOffice)}
                                placeholder={
                                  bp.isHeadOffice ? "Company GSTIN" : "Blank = head office GSTIN"
                                }
                                aria-label={`${bp.code} GSTIN`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Tile>
            )}

            <Tile title="Contact Details" icon={<Phone size={18} />}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextInput
                  label="Website"
                  name="website"
                  value={formData.website || ""}
                  onChange={handleChange}
                  placeholder="http://www.example.com"
                />
                <IndiaPhoneInput
                  multi
                  label="Mobile Numbers"
                  name="phones"
                  value={phones}
                  onChange={(e: any) => {
                    setPhones(e.target.value);
                    if (errors.mobile) {
                      setErrors((prev: any) => ({ ...prev, mobile: undefined }));
                    }
                  }}
                  maxNumbers={5}
                  error={errors.mobile}
                />
              </div>
            </Tile>

            <Tile title="Address Details" icon={<MapPin size={18} />}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextInput
                  label="Street Address"
                  name="addressLine1"
                  value={formData.addressLine1 || ""}
                  onChange={handleChange}
                  placeholder="Building, street, area"
                  required
                  error={errors.addressLine1}
                />
                <CityStateSelect
                  countryLabel=""
                  countryValue={formData.country || "India"}
                  onCountryChange={handleCountryChange}
                  countryError={errors.country}
                  stateLabel=""
                  stateValue={formData.state || ""}
                  onStateChange={handleStateChange}
                  stateError={errors.state}
                  cityLabel="City"
                  cityValue={formData.city || ""}
                  onCityChange={handleCityChange}
                  cityError={errors.city}
                  required
                  renderOnly="city"
                />
                <CityStateSelect
                  countryLabel="Country"
                  countryValue={formData.country || "India"}
                  onCountryChange={handleCountryChange}
                  countryError={errors.country}
                  stateLabel="State"
                  stateValue={formData.state || ""}
                  onStateChange={handleStateChange}
                  stateError={errors.state}
                  cityLabel=""
                  cityValue={formData.city || ""}
                  onCityChange={handleCityChange}
                  cityError={errors.city}
                  required
                  renderOnly="state-country"
                />
                <TextInput
                  label="Zipcode"
                  name="zipcode"
                  value={formData.zipcode || ""}
                  onChange={handleChange}
                  placeholder="Zipcode"
                  required
                  error={errors.zipcode}
                />
              </div>
            </Tile>
          </div>

          <div className="space-y-5">
            <Tile title="Branding" subtitle="Shown on documents and the sign-in page.">
              <div className="flex flex-col items-center gap-6">
                <ImageUpload
                  label="Company Logo"
                  name="logoFile"
                  hint="PNG or SVG · min 256×256px"
                  currentImageUrl={formData.logoUrl || undefined}
                  onChange={handleChange as any}
                />
                <ImageUpload
                  label="Favicon"
                  name="faviconFile"
                  hint="PNG · min 64×64px"
                  currentImageUrl={formData.faviconUrl || undefined}
                  onChange={handleChange as any}
                />
              </div>
            </Tile>
          </div>
        </div>

        <div className="hidden">
          <TextInput
            label="Company Code"
            name="companyCode"
            value={formData.companyCode || ""}
            onChange={handleChange}
            placeholder="Auto Generated"
            disabled
            error={errors.companyCode}
          />
        </div>

        {/* Footer */}
        {canEdit && (
          <div className="sl-tile sl-sticky-footer z-10 mt-5 flex items-center justify-end gap-2 px-4 py-3">
            <ActionPill variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </ActionPill>
            <ActionPill
              type="submit"
              icon={<Save size={17} />}
              disabled={loading}
              loading={loading}
            >
              {isEditMode ? "Save Changes" : "Create Company"}
            </ActionPill>
          </div>
        )}
      </form>
    </div>
  );
};

export default CompanySettings;
