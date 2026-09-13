import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  FaBuilding,
  FaHashtag,
  FaEdit,
  FaFileInvoiceDollar,
  FaPhone,
  FaServer,
} from "react-icons/fa";
import type { RootState, AppDispatch } from "../../../app/store";
import { fetchCompany } from "../../../features/company/companySlice";
import CustomButton from "../../../components/ui/Button/Button";
import { StatusBadge } from "../../../components/ui/StatusBadge/Badge";

const CompanyProfile: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { data: company, loading } = useSelector((state: RootState) => state.company);
  const { user } = useSelector((state: RootState) => state.auth);

  const canEdit = user?.roleId === "ROLE_ADMIN";

  useEffect(() => {
    dispatch(fetchCompany());
  }, [dispatch]);

  if (loading || !company) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin  h-10 w-10 border-b-2 border-accent"></div>
        <span className="ml-3 text-accent font-medium">Loading company profile...</span>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 min-h-screen bg-page">
      <div className="max-w-5xl mx-auto bg-card rounded-sm border border-line overflow-hidden">
        {/* HEADER */}
        <div className="px-6 py-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-line">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 md:w-20 md:h-20 bg-card-2 rounded-md border border-line flex items-center justify-center p-2 shrink-0 overflow-hidden">
              <img
                src={company.logoUrl || "/favicon.svg"}
                alt="Company Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h2 className="text-2xl md:text-3xl font-extrabold text-ink tracking-tight">
                {company.legalName || company.companyName || "Your Company"}
              </h2>
              <div className="flex items-center gap-2 mt-1 text-sm font-medium text-ink-muted">
                <FaBuilding className="text-ink-subtle" />
                <span>Enterprise Company Profile</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 bg-card-2 px-4 py-2 rounded-md border border-line">
            <div className="flex items-center gap-2 text-ink font-medium">
              <FaHashtag className="text-ink-subtle" />
              <span>{company.companyCode || "-"}</span>
            </div>
            <div className="w-px h-5 bg-line"></div>
            <div className="bg-card rounded-full">
              <StatusBadge status={company.isActive ? "ACTIVE" : "INACTIVE"} />
            </div>
          </div>
        </div>

        {/* BODY */}
        <div className="p-6 space-y-8">
          {/* General */}
          <section>
            <h3 className="text-sm font-bold text-ink-subtle uppercase tracking-widest flex items-center gap-2 border-b border-line-soft pb-2 mb-4">
              <FaBuilding className="text-ink-subtle" />
              General Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col space-y-1 p-3 bg-card rounded-lg border border-line-soft/50">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Legal Name
                </span>
                <span className="text-sm font-bold text-ink">
                  {company.legalName || company.companyName || "-"}
                </span>
              </div>
              <div className="flex flex-col space-y-1 p-3 bg-card rounded-lg border border-line-soft/50">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Company Code
                </span>
                <span className="text-sm font-bold text-ink">{company.companyCode || "-"}</span>
              </div>
            </div>
          </section>

          {/* Registration */}
          <section>
            <h3 className="text-sm font-bold text-ink-subtle uppercase tracking-widest flex items-center gap-2 border-b border-line-soft pb-2 mb-4">
              <FaFileInvoiceDollar className="text-ink-subtle" />
              Registration Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col space-y-1 p-3 bg-card rounded-lg border border-line-soft/50">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  GSTIN
                </span>
                <span className="text-sm font-bold text-ink tracking-wide">
                  {company.gstin || "-"}
                </span>
              </div>
              <div className="flex flex-col space-y-1 p-3 bg-card rounded-lg border border-line-soft/50">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Currency
                </span>
                <span className="text-sm font-bold text-ink">{company.currencyCode || "INR"}</span>
              </div>
            </div>
          </section>

          {/* Address */}
          <section>
            <h3 className="text-sm font-bold text-ink-subtle uppercase tracking-widest flex items-center gap-2 border-b border-line-soft pb-2 mb-4">
              <FaBuilding className="text-ink-subtle" />
              Address Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col space-y-1 p-3 bg-card rounded-lg border border-line-soft/50 lg:col-span-2">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Address Line 1
                </span>
                <span className="text-sm font-bold text-ink">{company.addressLine1 || "-"}</span>
              </div>
              <div className="flex flex-col space-y-1 p-3 bg-card rounded-lg border border-line-soft/50">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  City
                </span>
                <span className="text-sm font-bold text-ink">{company.city || "-"}</span>
              </div>
              <div className="flex flex-col space-y-1 p-3 bg-card rounded-lg border border-line-soft/50">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  State
                </span>
                <span className="text-sm font-bold text-ink">{company.state || "-"}</span>
              </div>
              <div className="flex flex-col space-y-1 p-3 bg-card rounded-lg border border-line-soft/50">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Zipcode
                </span>
                <span className="text-sm font-bold text-ink">{company.zipcode || "-"}</span>
              </div>
              <div className="flex flex-col space-y-1 p-3 bg-card rounded-lg border border-line-soft/50">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Country
                </span>
                <span className="text-sm font-bold text-ink">{company.country || "-"}</span>
              </div>
            </div>
          </section>

          {/* Contact */}
          <section>
            <h3 className="text-sm font-bold text-ink-subtle uppercase tracking-widest flex items-center gap-2 border-b border-line-soft pb-2 mb-4">
              <FaPhone className="text-ink-subtle" />
              Contact Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col space-y-1 p-3 bg-card rounded-lg border border-line-soft/50">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Phone
                </span>
                <span className="text-sm font-bold text-ink">{company.phone || "-"}</span>
              </div>
              <div className="flex flex-col space-y-1 p-3 bg-card rounded-lg border border-line-soft/50">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Email
                </span>
                <span className="text-sm font-bold text-ink">{company.email || "-"}</span>
              </div>
            </div>
          </section>

          {/* System */}
          <section>
            <h3 className="text-sm font-bold text-ink-subtle uppercase tracking-widest flex items-center gap-2 border-b border-line-soft pb-2 mb-4">
              <FaServer className="text-ink-subtle" />
              System Information
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <div className="flex flex-col space-y-3 p-4 bg-card rounded-lg border border-line-soft/50">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Logo Image
                </span>
                {company.logoUrl ? (
                  <div className="bg-card p-2 border border-line rounded-lg inline-block w-max">
                    <img
                      src={company.logoUrl}
                      alt="Company Logo"
                      className="max-w-37.5 max-h-20 object-contain"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-ink-subtle italic">No Logo Uploaded</span>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* FOOTER */}
        {canEdit && (
          <div className="px-6 py-4 bg-card border-t border-line-soft flex justify-end">
            <CustomButton
              text="Edit Company Profile"
              icon={FaEdit}
              onClick={() => navigate("/company/edit")}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default CompanyProfile;
