ALTER TABLE `DataRecord` ADD COLUMN `crawlTime` DATETIME(3) NULL;

ALTER TABLE `EventRecord`
    MODIFY `viewCount` INTEGER NULL,
    MODIFY `forwardCount` INTEGER NULL,
    MODIFY `replyCount` INTEGER NULL,
    MODIFY `praiseCount` INTEGER NULL;
