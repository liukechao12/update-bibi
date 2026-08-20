import { findMissingFields, parseRawTextRecords } from '@/lib/raw-parser';
import { mapRawRecordToPushRecord } from '@/lib/mapping';
import { pushRequestSchema } from '@/lib/schemas';

export function validateRawPasteText(sourceText: string) {
  const missing = findMissingFields(sourceText);
  const records = parseRawTextRecords(sourceText);
  const mapped = records.map((record) => mapRawRecordToPushRecord(record));
  const parsed = pushRequestSchema.safeParse({ version: '1', records: mapped });

  return {
    totalBlocks: records.length,
    missing,
    records: mapped,
    errors: parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
  };
}
