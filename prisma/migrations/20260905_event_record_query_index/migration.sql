-- AddIndex
CREATE INDEX `EventRecord_category_publishTime_id_idx` ON `EventRecord` (`category`, `publishTime`, `id`);
