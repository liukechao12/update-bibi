-- 来源部门字段：ExternalApiClient.department + DataBatch.sourceDepartment + DataRecord.sourceDepartment
ALTER TABLE DataBatch ADD COLUMN sourceDepartment VARCHAR(191) NULL;
CREATE INDEX `DataBatch_sourceDepartment_createdAt_idx` ON `DataBatch` (`sourceDepartment`, `createdAt`);
ALTER TABLE DataRecord ADD COLUMN sourceDepartment VARCHAR(191) NULL;
CREATE INDEX `DataRecord_sourceDepartment_createdAt_idx` ON `DataRecord` (`sourceDepartment`, `createdAt`);
ALTER TABLE ExternalApiClient ADD COLUMN department VARCHAR(191) NULL;
CREATE INDEX `ExternalApiClient_department_createdAt_idx` ON `ExternalApiClient` (`department`, `createdAt`);
