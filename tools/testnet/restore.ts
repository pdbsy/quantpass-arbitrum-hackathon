import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyServerBackup } from '../../packages/testnet/src/server-backups.ts';

/** Verification opens independent temporary copies only. It never replaces a live database. */
export async function restoreCli(args: readonly string[]): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'AlphaForge backup verification: --verify <backup-folder> <configuration-digest> <new-report.json>; original backups and live databases remain unchanged.',
    );
    return 0;
  }
  if (
    args.length !== 4 ||
    args[0] !== '--verify' ||
    args.slice(1).some((v) => v.startsWith('--')) ||
    !/^0x[0-9a-f]{64}$/.test(args[2]!)
  ) {
    console.error('RESTORE_USAGE');
    return 2;
  }
  try {
    const report = await verifyServerBackup(resolve(args[1]!), args[2]!);
    writeFileSync(
      resolve(args[3]!),
      JSON.stringify(
        { ...report, verifiedAt: new Date().toISOString(), liveDatabaseReplacement: 'NOT_RUN' },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log('ALPHAFORGE_BACKUP_COPIES_VERIFIED');
    return 0;
  } catch {
    console.error('BACKUP_VERIFICATION_REJECTED');
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await restoreCli(process.argv.slice(2));
