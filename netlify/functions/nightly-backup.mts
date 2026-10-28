// Saves a backup of every school every night at 02:00 Nairobi time (23:00 UTC).
import type { Config } from '@netlify/functions';
import { nightlyBackup } from '../../backend/index';

export default async (): Promise<void> => {
  await nightlyBackup();
};

export const config: Config = { schedule: '0 23 * * *' };
