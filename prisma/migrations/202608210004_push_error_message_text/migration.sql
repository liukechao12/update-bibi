ALTER TABLE `PushJobItem`
  MODIFY COLUMN `errorMessage` TEXT NULL,
  MODIFY COLUMN `vendorResponseCode` TEXT NULL;

ALTER TABLE `DataBatch`
  MODIFY COLUMN `remark` TEXT NULL;