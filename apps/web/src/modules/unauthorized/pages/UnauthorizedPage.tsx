import { FiLock } from "react-icons/fi";
import AccessStatePage from "../../../components/public/AccessStatePage";
const UnauthorizedPage = () => (
  <AccessStatePage
    code="403"
    title="Access denied"
    description="Your account does not have permission to open this page. Contact an administrator if you need access."
    icon={FiLock}
    tone="red"
  />
);
export default UnauthorizedPage;
