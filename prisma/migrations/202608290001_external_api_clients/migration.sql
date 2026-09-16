-- AlterTable
ALTER TABLE `MediaLibrary`
    ADD COLUMN `ruleType` ENUM('DOMAIN', 'ACCOUNT') NOT NULL DEFAULT 'DOMAIN',
    ADD COLUMN `rulePattern` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ExternalApiClient` (
    `id` VARCHAR(191) NOT NULL,
    `clientCode` VARCHAR(191) NOT NULL,
    `clientName` VARCHAR(191) NOT NULL,
    `apiKeyHash` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `allowAllEvents` BOOLEAN NOT NULL DEFAULT false,
    `rateLimitPerMinute` INTEGER NOT NULL DEFAULT 60,
    `expiresAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ExternalApiClient_clientCode_key`(`clientCode`),
    UNIQUE INDEX `ExternalApiClient_apiKeyHash_key`(`apiKeyHash`),
    INDEX `ExternalApiClient_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExternalApiClientEventScope` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `eventCategory` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ExternalApiClientEventScope_clientId_eventCategory_key`(`clientId`, `eventCategory`),
    INDEX `ExternalApiClientEventScope_eventCategory_idx`(`eventCategory`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExternalApiRequestLog` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `requestIp` VARCHAR(191) NULL,
    `requestQuery` JSON NULL,
    `responseCode` INTEGER NOT NULL,
    `responseCount` INTEGER NOT NULL DEFAULT 0,
    `costMs` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ExternalApiRequestLog_clientId_createdAt_idx`(`clientId`, `createdAt`),
    INDEX `ExternalApiRequestLog_path_createdAt_idx`(`path`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ExternalApiClient` ADD CONSTRAINT `ExternalApiClient_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExternalApiClientEventScope` ADD CONSTRAINT `ExternalApiClientEventScope_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `ExternalApiClient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExternalApiRequestLog` ADD CONSTRAINT `ExternalApiRequestLog_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `ExternalApiClient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
