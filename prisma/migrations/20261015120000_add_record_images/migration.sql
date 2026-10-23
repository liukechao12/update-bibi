-- CreateTable
CREATE TABLE `RecordImage` (
    `id` VARCHAR(191) NOT NULL,
    `recordId` VARCHAR(191) NOT NULL,
    `sourceUrl` TEXT NOT NULL,
    `localPath` TEXT NOT NULL,
    `vendorUrl` TEXT NULL,
    `mimeType` VARCHAR(191) NOT NULL DEFAULT 'image/png',
    `fileSize` INTEGER NOT NULL,
    `sha256` VARCHAR(191) NULL,
    `uploadStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `uploadedAt` DATETIME(3) NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RecordImage_recordId_idx`(`recordId`),
    INDEX `RecordImage_uploadStatus_idx`(`uploadStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RecordImage` ADD CONSTRAINT `RecordImage_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `DataRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
