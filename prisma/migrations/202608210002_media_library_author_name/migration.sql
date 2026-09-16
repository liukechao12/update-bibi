ALTER TABLE `MediaLibrary`
  ADD COLUMN `authorName` VARCHAR(191) NULL AFTER `platformName`;

CREATE INDEX `MediaLibrary_domain_authorName_status_idx`
  ON `MediaLibrary` (`domain`, `authorName`, `status`);
