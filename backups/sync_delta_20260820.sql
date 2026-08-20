-- ============================================================
-- 增量同步：将 jiebao 库对齐到当前 prisma/schema.prisma
-- 执行前已备份：backups/jiebao_full_backup_20260820_1326.sql
-- ============================================================

-- 1. User 表补充 accountType 列
ALTER TABLE `User` ADD COLUMN `accountType` VARCHAR(191) NULL DEFAULT 'social';

-- 2. DataRecord 补充 publisherType / authorType 列
ALTER TABLE `DataRecord`
  ADD COLUMN `publisherType` ENUM('MEDIA', 'SOCIAL') NOT NULL DEFAULT 'SOCIAL',
  ADD COLUMN `authorType` ENUM('BLUE_V', 'SELF_MEDIA', 'PERSONAL') NULL;

-- 3. originType 由 varchar(191) 转换为小写枚举（数据已修正为 media/wb/wx）
ALTER TABLE `DataRecord`
  MODIFY COLUMN `originType` ENUM('media', 'xhs', 'wb', 'wx', 'sph', 'dy', 'zh', 'tb', 'other') NOT NULL;

-- 4. 补充缺失的索引
CREATE INDEX `DataRecord_originType_publisherType_idx` ON `DataRecord` (`originType`, `publisherType`);
CREATE INDEX `DataRecord_createdById_createdAt_idx` ON `DataRecord` (`createdById`, `createdAt`);

-- 5. 新建 MediaLibrary 表
CREATE TABLE `MediaLibrary` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NULL,
    `platformName` VARCHAR(191) NULL,
    `originType` ENUM('media', 'xhs', 'wb', 'wx', 'sph', 'dy', 'zh', 'tb', 'other') NOT NULL,
    `publisherType` ENUM('MEDIA', 'SOCIAL') NOT NULL,
    `authorType` ENUM('BLUE_V', 'SELF_MEDIA', 'PERSONAL') NULL,
    `ruleType` ENUM('DOMAIN', 'ACCOUNT') NOT NULL DEFAULT 'DOMAIN',
    `rulePattern` VARCHAR(191) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `remark` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MediaLibrary_originType_publisherType_idx`(`originType`, `publisherType`),
    INDEX `MediaLibrary_status_priority_idx`(`status`, `priority`),
    UNIQUE INDEX `MediaLibrary_domain_ruleType_key`(`domain`, `ruleType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 6. MediaLibrary 外键
ALTER TABLE `MediaLibrary` ADD CONSTRAINT `MediaLibrary_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
