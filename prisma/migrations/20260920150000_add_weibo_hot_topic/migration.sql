-- 微博热点快照表：每10分钟抓取一次热搜榜并做关键词匹配（B站/bilibili/哔哩哔哩/陈睿）
CREATE TABLE `WeiboHotTopic` (
    `id` VARCHAR(191) NOT NULL,
    `batchAt` DATETIME(3) NOT NULL,
    `rank` INTEGER NOT NULL,
    `word` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `category` VARCHAR(191) NULL,
    `subjectQuerys` VARCHAR(191) NULL,
    `labelName` VARCHAR(191) NULL,
    `hotNum` INTEGER NOT NULL DEFAULT 0,
    `onboardTime` DATETIME(3) NULL,
    `content` TEXT NULL,
    `matched` BOOLEAN NOT NULL DEFAULT false,
    `matchedKeywords` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `WeiboHotTopic_batchAt_idx` (`batchAt`),
    INDEX `WeiboHotTopic_matched_batchAt_idx` (`matched`, `batchAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
