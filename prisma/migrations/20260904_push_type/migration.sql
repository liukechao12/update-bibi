-- AlterTable
ALTER TABLE `PushJob`
    ADD COLUMN `pushType` VARCHAR(191) NOT NULL DEFAULT 'CREATE' AFTER `version`;

-- AlterTable
ALTER TABLE `PushJobItem`
    ADD COLUMN `pushType` VARCHAR(191) NOT NULL DEFAULT 'CREATE' AFTER `itemIndex`,
    ADD COLUMN `previousCommentNum` INT NULL AFTER `pushType`,
    ADD COLUMN `previousForwardNum` INT NULL AFTER `previousCommentNum`,
    ADD COLUMN `previousPraiseNum` INT NULL AFTER `previousForwardNum`,
    ADD COLUMN `previousViewNum` INT NULL AFTER `previousPraiseNum`;
