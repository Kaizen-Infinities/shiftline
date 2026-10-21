-- Department names are unique per tenant (R2H-B10). Two identical creates that race past the
-- findFirst check used to insert the same name twice. Before deploying on a large install, check
-- for existing duplicates: SELECT company_id, name, count(*) FROM departments GROUP BY 1, 2 HAVING count(*) > 1;
CREATE UNIQUE INDEX "departments_company_id_name_key" ON "departments"("company_id", "name");
