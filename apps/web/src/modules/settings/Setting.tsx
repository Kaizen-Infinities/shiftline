import React from "react";
import { Container } from "../../components/ui/TailwindPrimitives";
import { FaCog, FaBuilding } from "react-icons/fa";
import type { TabItem } from "../../components/ui/tab/Tabs";
import Tabs from "../../components/ui/tab/Tabs";

const Section: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  children,
}) => (
  <div className="mb-4 rounded-sm border border-line bg-card p-4">
    <div className="mb-3 flex items-center gap-2 border-b border-line-soft pb-2">
      {icon && (
        <span className="flex h-8 w-8 items-center justify-center rounded-sm border border-accent/40 text-accent">
          {icon}
        </span>
      )}
      <h6 className="mb-0 font-bold text-ink">{title}</h6>
    </div>
    {children}
  </div>
);

const GeneralSettingsTab: React.FC = () => (
  <Section title="General Settings" icon={<FaCog />}>
    <p className="mb-0 text-sm text-ink-muted">Company name, timezone, currency, etc.</p>
  </Section>
);

const CompanyProfileTab: React.FC = () => (
  <Section title="Company Profile" icon={<FaBuilding />}>
    <p className="mb-0 text-sm text-ink-muted">Address, logo, registration details, etc.</p>
  </Section>
);

const SettingPage: React.FC = () => {
  const tabs: TabItem[] = [
    { key: "general", label: "General Settings", icon: <FaCog />, content: <GeneralSettingsTab /> },
    {
      key: "company",
      label: "Company Profile",
      icon: <FaBuilding />,
      content: <CompanyProfileTab />,
    },
  ];

  return (
    <div>
      <Container>
        <Tabs tabs={tabs} defaultActiveKey="general" />
      </Container>
    </div>
  );
};

export default SettingPage;
