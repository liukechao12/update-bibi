-- Add indexes for DataBatch queries
CREATE INDEX `DataBatch_createdById_createdAt_idx` ON `DataBatch` (`createdById`, `createdAt`);
CREATE INDEX `DataBatch_status_createdAt_idx` ON `DataBatch` (`status`, `createdAt`);

-- Add indexes for PushJob queries (list page, dashboard)
CREATE INDEX `PushJob_createdById_createdAt_idx` ON `PushJob` (`createdById`, `createdAt`);
CREATE INDEX `PushJob_status_createdAt_idx` ON `PushJob` (`status`, `createdAt`);
CREATE INDEX `PushJob_createdAt_idx` ON `PushJob` (`createdAt`);

-- Add index for PushJobItem queries (record push history)
CREATE INDEX `PushJobItem_recordId_status_idx` ON `PushJobItem` (`recordId`, `status`);

-- Add indexes for AuditLog queries (audit trail)
CREATE INDEX `AuditLog_userId_createdAt_idx` ON `AuditLog` (`userId`, `createdAt`);
CREATE INDEX `AuditLog_createdAt_idx` ON `AuditLog` (`createdAt`);

-- Add index for ImportFile queries (batch files)
CREATE INDEX `ImportFile_batchId_idx` ON `ImportFile` (`batchId`);