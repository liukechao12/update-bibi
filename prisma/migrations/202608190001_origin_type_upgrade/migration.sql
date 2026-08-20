-- Alter data to match new enum values before changing column type
UPDATE `DataRecord` SET `originType` = 'WB' WHERE `originType` = 'wb';
UPDATE `DataRecord` SET `originType` = 'WX' WHERE `originType` = 'wx';
UPDATE `DataRecord` SET `originType` = 'MEDIA' WHERE `originType` = 'wz';
UPDATE `DataRecord` SET `originType` = 'MEDIA' WHERE `originType` = 'sp';
UPDATE `DataRecord` SET `originType` = 'MEDIA' WHERE `originType` = 'lt';
UPDATE `DataRecord` SET `originType` = 'OTHER' WHERE `originType` = 'app';

-- Add new enum columns
ALTER TABLE `DataRecord`
  ADD COLUMN `publisherType` ENUM('MEDIA', 'SOCIAL') NOT NULL DEFAULT 'SOCIAL',
  ADD COLUMN `authorType` ENUM('BLUE_V', 'SELF_MEDIA', 'PERSONAL') NULL;

-- Convert existing originType column to enum
ALTER TABLE `DataRecord`
  MODIFY COLUMN `originType` ENUM('MEDIA', 'XHS', 'WB', 'WX', 'SPH', 'DY', 'ZH', 'TB', 'OTHER') NOT NULL;

-- Improve query performance for common filters
CREATE INDEX `DataRecord_createdById_recordStatus_createdAt_idx` ON `DataRecord` (`createdById`, `recordStatus`, `createdAt`);
CREATE INDEX `DataRecord_recordStatus_createdAt_idx` ON `DataRecord` (`recordStatus`, `createdAt`);
CREATE INDEX `DataRecord_createdAt_idx` ON `DataRecord` (`createdAt`);
CREATE INDEX `DataRecord_originType_publisherType_idx` ON `DataRecord` (`originType`, `publisherType`);
