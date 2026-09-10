import type { IconType } from "react-icons";
import BackButton from "../ui/BackButton/BackButton";
import PublicShell from "./PublicShell";

interface AccessStatePageProps {
  code: string;
  title: string;
  description: string;
  icon: IconType;
  tone: "amber" | "red";
}
const tones = { amber: "bg-amber-500/15 text-amber-600", red: "bg-red-500/15 text-red-600" };
const AccessStatePage = ({ code, title, description, icon: Icon, tone }: AccessStatePageProps) => (
  <PublicShell compact eyebrow={`Error ${code}`} title={title} description={description}>
    <div className="flex flex-col items-start gap-6">
      <div className={`flex size-16 items-center justify-center rounded-2xl ${tones[tone]}`}>
        <Icon aria-hidden="true" className="text-3xl" />
      </div>
      <BackButton to="/dashboard" text="Go to dashboard" />
    </div>
  </PublicShell>
);
export default AccessStatePage;
