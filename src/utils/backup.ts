import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import mongoose from 'mongoose';
import { logger } from './logger';

const BACKUP_DIR = path.resolve(__dirname, '../../backups');
const RETENTION_DAYS = 7;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// ─── Local Zip Backup ─────────────────────────────────────────────────────────

async function runLocalBackup(): Promise<void> {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempDir = path.join(BACKUP_DIR, `temp-${timestamp}`);
  const zipPath = path.join(BACKUP_DIR, `backup-${timestamp}.zip`);

  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No active MongoDB connection');

    const collections = await db.listCollections().toArray();
    logger.info(`[Backup] Local: dumping ${collections.length} collections → ${zipPath}`);

    for (const col of collections) {
      const docs = await db.collection(col.name).find({}).toArray();
      const filePath = path.join(tempDir, `${col.name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
    }

    await zipDirectory(tempDir, zipPath);
    logger.info(`[Backup] Local zip complete: ${zipPath}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function zipDirectory(sourceDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function cleanOldBackups(): void {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;

    const now = Date.now();
    for (const entry of fs.readdirSync(BACKUP_DIR)) {
      const entryPath = path.join(BACKUP_DIR, entry);
      const stat = fs.statSync(entryPath);
      const isBackup =
        (entry.startsWith('backup-') && entry.endsWith('.zip')) ||
        (stat.isDirectory() && entry.startsWith('backup-'));

      if (isBackup && now - stat.mtimeMs > RETENTION_DAYS * TWENTY_FOUR_HOURS_MS) {
        fs.rmSync(entryPath, { recursive: true, force: true });
        logger.info(`[Backup] Deleted old local backup: ${entry}`);
      }
    }
  } catch (error) {
    logger.error('[Backup] Error cleaning old backups:', error);
  }
}

// ─── Remote MongoDB Backup ────────────────────────────────────────────────────

/**
 * Mirrors every collection from the main DB into a separate backup MongoDB.
 * Each collection in the backup DB is fully replaced on every run.
 * A _backup_log collection records each run's metadata.
 *
 * Set BACKUP_MONGODB_URI in your environment to enable this.
 */
async function runRemoteMongoBackup(): Promise<void> {
  const backupUri = process.env.BACKUP_MONGODB_URI;
  if (!backupUri) return; // silently skip if not configured

  const sourceDb = mongoose.connection.db;
  if (!sourceDb) throw new Error('No active source MongoDB connection');

  logger.info('[Backup] Remote MongoDB: connecting to backup database...');

  const backupConn = await mongoose.createConnection(backupUri).asPromise();
  const backupDb = backupConn.db;

  try {
    const collections = await sourceDb.listCollections().toArray();
    const timestamp = new Date();
    const stats: { collection: string; count: number }[] = [];

    logger.info(`[Backup] Remote MongoDB: mirroring ${collections.length} collections...`);

    for (const col of collections) {
      // Skip the backup log itself if it exists in source
      if (col.name === '_backup_log') continue;

      const docs = await sourceDb.collection(col.name).find({}).toArray();

      if (docs.length > 0) {
        // Drop and re-insert for a clean mirror
        await backupDb.collection(col.name).drop().catch(() => {}); // ignore if doesn't exist
        await backupDb.collection(col.name).insertMany(docs);
      }

      stats.push({ collection: col.name, count: docs.length });
      logger.info(`[Backup] Remote: ${col.name} → ${docs.length} docs`);
    }

    // Write a log entry so you can see when the last backup ran
    await backupDb.collection('_backup_log').insertOne({
      backedUpAt: timestamp,
      collections: stats,
      totalCollections: collections.length,
      totalDocs: stats.reduce((sum, s) => sum + s.count, 0),
    });

    logger.info(`[Backup] Remote MongoDB backup complete ✅ (${stats.length} collections)`);
  } finally {
    await backupConn.close();
  }
}

// ─── Combined Backup Runner ───────────────────────────────────────────────────

async function runBackup(): Promise<void> {
  const results = await Promise.allSettled([
    runLocalBackup(),
    runRemoteMongoBackup(),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error('[Backup] One backup target failed:', result.reason?.message ?? result.reason);
    }
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export function setupDailyBackup(): void {
  if (process.env.NODE_ENV !== 'production') {
    logger.info('[Backup] Skipped (development mode)');
    return;
  }

  logger.info('[Backup] Daily scheduler initialized (local zip + remote MongoDB)');

  // First run 60 seconds after startup
  setTimeout(async () => {
    try {
      await runBackup();
      cleanOldBackups();
    } catch (error) {
      logger.error('[Backup] Initial backup failed:', error);
    }
  }, 60_000);

  // Then every 24 hours
  setInterval(async () => {
    try {
      await runBackup();
      cleanOldBackups();
    } catch (error) {
      logger.error('[Backup] Scheduled backup failed:', error);
    }
  }, TWENTY_FOUR_HOURS_MS);
}
