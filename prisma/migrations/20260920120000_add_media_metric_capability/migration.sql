-- 媒体采集能力表：按来源网站记录评论/转发/点赞是否可采集（0=可采集，null=不可采集）
CREATE TABLE `MediaMetricCapability` (
    `id` VARCHAR(191) NOT NULL,
    `sourceName` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `commentCollectable` BOOLEAN NOT NULL DEFAULT false,
    `forwardCollectable` BOOLEAN NOT NULL DEFAULT false,
    `praiseCollectable` BOOLEAN NOT NULL DEFAULT false,
    `remark` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `MediaMetricCapability_sourceName_key` (`sourceName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 数据记录保存导入时的来源名称，推送时按它查询采集能力
ALTER TABLE `DataRecord` ADD COLUMN `sourceName` VARCHAR(191) NULL;
CREATE INDEX `DataRecord_sourceName_idx` ON `DataRecord` (`sourceName`);
