-- 微信推送去重状态表：记录每个热点词+榜单最近一次推送时的排名，排名变化才再次推送
CREATE TABLE `WeiboHotNotify` (
    `id` VARCHAR(191) NOT NULL,
    `word` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `firstSeenAt` DATETIME(3) NOT NULL,
    `lastPushedRank` INTEGER NOT NULL,
    `lastPushedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `WeiboHotNotify_word_channel_key` (`word`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
