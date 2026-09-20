-- 微博热点增加榜单渠道字段：热搜/文娱/社会/科技/生活/体育/ACG
ALTER TABLE `WeiboHotTopic` ADD COLUMN `channel` VARCHAR(191) NOT NULL DEFAULT '热搜';
CREATE INDEX `WeiboHotTopic_batchAt_channel_idx` ON `WeiboHotTopic` (`batchAt`, `channel`);
