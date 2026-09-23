ALTER TABLE `DataRecord`
    ADD COLUMN `lastPluginClientId` VARCHAR(191) NULL,
    ADD COLUMN `lastPluginReceivedAt` DATETIME(3) NULL;

CREATE INDEX `DataRecord_lastPluginReceivedAt_id_idx` ON `DataRecord` (`lastPluginReceivedAt`, `id`);
CREATE INDEX `DataRecord_lastPluginClientId_lastPluginReceivedAt_idx` ON `DataRecord` (`lastPluginClientId`, `lastPluginReceivedAt`);

ALTER TABLE `DataRecord` ADD CONSTRAINT `DataRecord_lastPluginClientId_fkey`
    FOREIGN KEY (`lastPluginClientId`) REFERENCES `ExternalApiClient` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
