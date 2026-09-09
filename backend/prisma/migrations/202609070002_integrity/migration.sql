ALTER TABLE "Employee" ADD CONSTRAINT "Employee_salary_positive" CHECK (salary > 0);
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_dates_coherent" CHECK ("birthDate" < "admissionDate" AND ("terminationDate" IS NULL OR "terminationDate" >= "admissionDate"));
ALTER TABLE "VacationPeriod" ADD CONSTRAINT "VacationPeriod_days_valid" CHECK (days > 0 AND "soldDays" >= 0 AND "endDate" >= "startDate" AND "endDate" - "startDate" + 1 = days AND "returnDate" = "endDate" + 1);
ALTER TABLE "VacationAccrualPeriod" ADD CONSTRAINT "VacationAccrualPeriod_balance_valid" CHECK ("acquiredDays" >= 0 AND "reducedDays" >= 0 AND "reducedDays" <= "acquiredDays" AND "endDate" >= "startDate" AND deadline > "endDate");
ALTER TABLE "EmployeeBenefit" ADD CONSTRAINT "EmployeeBenefit_value_valid" CHECK (value >= 0);
ALTER TABLE "EmployeeAllowance" ADD CONSTRAINT "EmployeeAllowance_value_valid" CHECK (value >= 0);
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
