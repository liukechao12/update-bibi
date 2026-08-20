-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `department` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `User_username_key`(`username`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` VARCHAR(191) NOT NULL,
    `roleCode` VARCHAR(191) NOT NULL,
    `roleName` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `Role_roleCode_key`(`roleCode`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` VARCHAR(191) NOT NULL,
    `permCode` VARCHAR(191) NOT NULL,
    `permName` VARCHAR(191) NOT NULL,
    `moduleName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `Permission_permCode_key`(`permCode`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserRole` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `UserRole_userId_roleId_key`(`userId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `id` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `RolePermission_roleId_permissionId_key`(`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DataBatch` (
    `id` VARCHAR(191) NOT NULL,
    `batchNo` VARCHAR(191) NOT NULL,
    `importType` ENUM('PASTE', 'EXCEL', 'MANUAL', 'API') NOT NULL,
    `sourceFileName` VARCHAR(191) NULL,
    `sourceSheetName` VARCHAR(191) NULL,
    `totalCount` INTEGER NOT NULL DEFAULT 0,
    `validCount` INTEGER NOT NULL DEFAULT 0,
    `invalidCount` INTEGER NOT NULL DEFAULT 0,
    `pushCount` INTEGER NOT NULL DEFAULT 0,
    `successCount` INTEGER NOT NULL DEFAULT 0,
    `failCount` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('CREATED', 'VALIDATING', 'PENDING_PUSH', 'PUSHING', 'PARTIAL_SUCCESS', 'SUCCESS', 'FAILED', 'CLOSED') NOT NULL DEFAULT 'CREATED',
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `pushedAt` DATETIME(3) NULL,
    `remark` VARCHAR(191) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `DataBatch_batchNo_key`(`batchNo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DataRecord` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `textId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `text` LONGTEXT NOT NULL,
    `publishTime` DATETIME(3) NOT NULL,
    `author` VARCHAR(191) NOT NULL,
    `originType` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `commentNum` INTEGER NOT NULL,
    `forwardNum` INTEGER NULL,
    `praiseNum` INTEGER NULL,
    `viewNum` INTEGER NULL,
    `tendency` VARCHAR(191) NULL,
    `rawSourceText` LONGTEXT NULL,
    `sourceRowNo` INTEGER NULL,
    `recordStatus` ENUM('DRAFT', 'VALIDATED', 'PENDING_PUSH', 'PUSHING', 'SUCCESS', 'FAILED', 'RETRYING', 'DUPLICATE') NOT NULL DEFAULT 'DRAFT',
    `isDuplicate` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `DataRecord_textId_key`(`textId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushJob` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `jobNo` VARCHAR(191) NOT NULL,
    `env` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL DEFAULT '1',
    `requestBody` JSON NOT NULL,
    `responseBody` JSON NULL,
    `httpStatus` INTEGER NULL,
    `insertedCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `retryCount` INTEGER NOT NULL DEFAULT 0,
    `nextRetryAt` DATETIME(3) NULL,
    `status` ENUM('PENDING', 'SENDING', 'SUCCESS', 'FAILED', 'RETRYING') NOT NULL DEFAULT 'PENDING',
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `PushJob_jobNo_key`(`jobNo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushJobItem` (
    `id` VARCHAR(191) NOT NULL,
    `pushJobId` VARCHAR(191) NOT NULL,
    `recordId` VARCHAR(191) NOT NULL,
    `itemIndex` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `errorMessage` VARCHAR(191) NULL,
    `vendorResponseCode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `PushJobItem_pushJobId_itemIndex_key`(`pushJobId`, `itemIndex`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportFile` (
    `id` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `filePath` VARCHAR(191) NOT NULL,
    `fileSize` BIGINT NOT NULL,
    `fileHash` VARCHAR(191) NOT NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `parseStatus` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemConfig` (
    `id` VARCHAR(191) NOT NULL,
    `configKey` VARCHAR(191) NOT NULL,
    `configValue` VARCHAR(191) NOT NULL,
    `configType` VARCHAR(191) NOT NULL,
    `remark` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `SystemConfig_configKey_key`(`configKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `actionType` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `actionDesc` VARCHAR(191) NOT NULL,
    `requestData` JSON NULL,
    `resultData` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserRole` ADD CONSTRAINT `UserRole_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserRole` ADD CONSTRAINT `UserRole_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DataBatch` ADD CONSTRAINT `DataBatch_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DataRecord` ADD CONSTRAINT `DataRecord_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `DataBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DataRecord` ADD CONSTRAINT `DataRecord_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PushJob` ADD CONSTRAINT `PushJob_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `DataBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PushJob` ADD CONSTRAINT `PushJob_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PushJobItem` ADD CONSTRAINT `PushJobItem_pushJobId_fkey` FOREIGN KEY (`pushJobId`) REFERENCES `PushJob`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PushJobItem` ADD CONSTRAINT `PushJobItem_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `DataRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ImportFile` ADD CONSTRAINT `ImportFile_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ImportFile` ADD CONSTRAINT `ImportFile_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `DataBatch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `SystemConfig` ADD CONSTRAINT `SystemConfig_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
