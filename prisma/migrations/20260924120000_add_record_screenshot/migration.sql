ALTER TABLE `DataRecord`
    ADD COLUMN `screenshotPath` VARCHAR(191) NULL,
    ADD COLUMN `screenshotStatus` VARCHAR(32) NULL,
    ADD COLUMN `screenshotError` TEXT NULL,
    ADD COLUMN `screenshotAt` DATETIME(3) NULL;
