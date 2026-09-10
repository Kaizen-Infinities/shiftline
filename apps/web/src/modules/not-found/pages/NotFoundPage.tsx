import { FiAlertCircle } from "react-icons/fi";
import AccessStatePage from "../../../components/public/AccessStatePage";
const NotFoundPage = () => (
  <AccessStatePage
    code="404"
    title="Page not found"
    description="The page may have moved, been renamed, or is no longer available."
    icon={FiAlertCircle}
    tone="amber"
  />
);
export default NotFoundPage;
