import React from "react";
import { Container, Button, Form } from "../../../components/ui/TailwindPrimitives";
import { FaSearch, FaPlus } from "react-icons/fa";

const SupplierViewPage: React.FC = () => {
  return (
    <div>
      <Container fluid>
        <div className="max-w-[1024px] xl:mr-auto bg-card rounded-sm border border-line overflow-hidden">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-6 border-b border-line">
            <div>
              <h2 className="text-2xl font-bold text-ink">Suppliers</h2>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="relative w-full md:w-64">
                <FaSearch
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
                  size={14}
                />
                <Form.Control type="text" className="pl-10" placeholder="Search supplier..." />
              </div>

              <Button className="gap-2">
                <FaPlus />
                Add Customer
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </div>
  );
};

export default SupplierViewPage;
