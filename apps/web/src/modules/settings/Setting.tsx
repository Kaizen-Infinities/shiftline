import React from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  ChevronRight,
  Coins,
  Cpu,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Mail,
  MessageCircle,
  MessageSquare,
  Percent,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Smartphone,
  Truck,
  Users,
} from "lucide-react";

import { PageHeader, SectionLabel } from "../../components/ui/v2";
import { usePermission } from "../../hooks/usePermission";

/**
 * The settings hub: every configuration screen as a tile, grouped by what it configures.
 * A tile shows only when the user may open its screen.
 */
interface SettingLink {
  title: string;
  description: string;
  to: string;
  icon: React.ReactNode;
  /** Any one of these opens the screen; none means every signed-in user. */
  permissions?: string[];
}

const IMPORT_PERMISSIONS = [
  "customers.create",
  "suppliers.create",
  "products.create",
  "raw_materials.create",
  "accounts.create",
  "chart-of-accounts.create",
  "finished_goods_stocks.create",
  "raw_material_stocks.create",
  "stores.edit",
];

const GROUPS: { label: string; items: SettingLink[] }[] = [
  {
    label: "Company",
    items: [
      {
        title: "Company profile",
        description: "Legal name, GSTIN, places of business, address and logo.",
        to: "/settings/company",
        icon: <Building2 size={20} />,
      },
      {
        title: "Invoice settings",
        description: "Numbering, terms and what prints on an invoice.",
        to: "/settings/invoice",
        icon: <ReceiptText size={20} />,
      },
      {
        title: "Currencies and rates",
        description: "Foreign currencies and the exchange rates the books use.",
        to: "/settings/currencies",
        icon: <Coins size={20} />,
        permissions: ["currencies.view"],
      },
    ],
  },
  {
    label: "People and access",
    items: [
      {
        title: "Users",
        description: "Invite people and manage who can sign in.",
        to: "/users",
        icon: <Users size={20} />,
        permissions: ["users.view"],
      },
      {
        title: "Roles",
        description: "What each role may see and do.",
        to: "/roles",
        icon: <ShieldCheck size={20} />,
        permissions: ["roles.view"],
      },
      {
        title: "Field devices",
        description: "Phones running the field app; revoke a lost one.",
        to: "/settings/devices",
        icon: <Smartphone size={20} />,
        permissions: ["mobile-app.manage"],
      },
    ],
  },
  {
    label: "Tax and compliance",
    items: [
      {
        title: "GST masters",
        description: "HSN and SAC codes with their tax rates.",
        to: "/settings/gst",
        icon: <Percent size={20} />,
        permissions: ["gst_tax.view"],
      },
      {
        title: "E-invoicing",
        description: "The GSP connection that raises IRNs.",
        to: "/settings/e-invoice",
        icon: <FileCheck2 size={20} />,
        permissions: ["e-invoice.settings"],
      },
      {
        title: "Transporters",
        description: "Transporter IDs used on e-way bills.",
        to: "/settings/transporters",
        icon: <Truck size={20} />,
        permissions: ["transporters.view"],
      },
    ],
  },
  {
    label: "Messaging",
    items: [
      {
        title: "Email",
        description: "The mail server documents and invitations go out through.",
        to: "/email-config",
        icon: <Mail size={20} />,
      },
      {
        title: "SMS and OTP",
        description: "Text message provider, templates and delivery log.",
        to: "/settings/sms",
        icon: <MessageSquare size={20} />,
        permissions: ["sms.view"],
      },
      {
        title: "WhatsApp",
        description: "The WhatsApp Business account for sharing documents.",
        to: "/whatsapp",
        icon: <MessageCircle size={20} />,
      },
    ],
  },
  {
    label: "Data and machines",
    items: [
      {
        title: "Data imports",
        description: "Bring masters and opening balances in from a spreadsheet.",
        to: "/settings/imports",
        icon: <FileSpreadsheet size={20} />,
        permissions: IMPORT_PERMISSIONS,
      },
      {
        title: "Account export",
        description: "Download everything the company has in Shiftline.",
        to: "/settings/export",
        icon: <Download size={20} />,
        permissions: ["account-export.view"],
      },
      {
        title: "Machine gateways",
        description: "Connect shop-floor machines that report their counts.",
        to: "/settings/machine-gateways",
        icon: <Cpu size={20} />,
        permissions: ["machine-telemetry.view"],
      },
    ],
  },
];

const SettingPage: React.FC = () => {
  const { can } = usePermission();
  const allowed = (item: SettingLink) => !item.permissions || item.permissions.some((p) => can(p));

  return (
    <div className="sl-page sl-page-form">
      <PageHeader
        title="Settings"
        icon={<Settings2 size={22} />}
        subtitle="How the company is set up: identity, people, tax, messaging and data."
      />
      {GROUPS.map((group) => {
        const items = group.items.filter(allowed);
        if (items.length === 0) return null;
        return (
          <section key={group.label} aria-label={group.label}>
            <SectionLabel>{group.label}</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="sl-tile sl-tile-hover group flex items-start gap-3 p-4 text-ink no-underline"
                >
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-chip text-accent"
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{item.title}</span>
                    <span className="mt-0.5 block text-sm text-ink-muted">{item.description}</span>
                  </span>
                  <ChevronRight
                    size={18}
                    aria-hidden="true"
                    className="mt-1 shrink-0 text-ink-subtle transition group-hover:translate-x-0.5"
                  />
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default SettingPage;
