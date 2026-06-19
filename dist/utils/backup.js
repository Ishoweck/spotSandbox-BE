"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupDailyBackup = setupDailyBackup;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const archiver_1 = __importDefault(require("archiver"));
const mongoose_1 = __importDefault(require("mongoose"));
const logger_1 = require("./logger");
const BACKUP_DIR = path_1.default.resolve(__dirname, '../../backups');
const RETENTION_DAYS = 7;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
// ─── Local Zip Backup ─────────────────────────────────────────────────────────
async function runLocalBackup() {
    if (!fs_1.default.existsSync(BACKUP_DIR)) {
        fs_1.default.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tempDir = path_1.default.join(BACKUP_DIR, `temp-${timestamp}`);
    const zipPath = path_1.default.join(BACKUP_DIR, `backup-${timestamp}.zip`);
    fs_1.default.mkdirSync(tempDir, { recursive: true });
    try {
        const db = mongoose_1.default.connection.db;
        if (!db)
            throw new Error('No active MongoDB connection');
        const collections = await db.listCollections().toArray();
        logger_1.logger.info(`[Backup] Local: dumping ${collections.length} collections → ${zipPath}`);
        for (const col of collections) {
            const docs = await db.collection(col.name).find({}).toArray();
            const filePath = path_1.default.join(tempDir, `${col.name}.json`);
            fs_1.default.writeFileSync(filePath, JSON.stringify(docs, null, 2));
        }
        await zipDirectory(tempDir, zipPath);
        logger_1.logger.info(`[Backup] Local zip complete: ${zipPath}`);
    }
    finally {
        fs_1.default.rmSync(tempDir, { recursive: true, force: true });
    }
}
function zipDirectory(sourceDir, outPath) {
    return new Promise((resolve, reject) => {
        const output = fs_1.default.createWriteStream(outPath);
        const archive = (0, archiver_1.default)('zip', { zlib: { level: 6 } });
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}
function cleanOldBackups() {
    try {
        if (!fs_1.default.existsSync(BACKUP_DIR))
            return;
        const now = Date.now();
        for (const entry of fs_1.default.readdirSync(BACKUP_DIR)) {
            const entryPath = path_1.default.join(BACKUP_DIR, entry);
            const stat = fs_1.default.statSync(entryPath);
            const isBackup = (entry.startsWith('backup-') && entry.endsWith('.zip')) ||
                (stat.isDirectory() && entry.startsWith('backup-'));
            if (isBackup && now - stat.mtimeMs > RETENTION_DAYS * TWENTY_FOUR_HOURS_MS) {
                fs_1.default.rmSync(entryPath, { recursive: true, force: true });
                logger_1.logger.info(`[Backup] Deleted old local backup: ${entry}`);
            }
        }
    }
    catch (error) {
        logger_1.logger.error('[Backup] Error cleaning old backups:', error);
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
async function runRemoteMongoBackup() {
    const backupUri = process.env.BACKUP_MONGODB_URI;
    if (!backupUri)
        return; // silently skip if not configured
    const sourceDb = mongoose_1.default.connection.db;
    if (!sourceDb)
        throw new Error('No active source MongoDB connection');
    logger_1.logger.info('[Backup] Remote MongoDB: connecting to backup database...');
    const backupConn = await mongoose_1.default.createConnection(backupUri).asPromise();
    const backupDb = backupConn.db;
    try {
        const collections = await sourceDb.listCollections().toArray();
        const timestamp = new Date();
        const stats = [];
        logger_1.logger.info(`[Backup] Remote MongoDB: mirroring ${collections.length} collections...`);
        for (const col of collections) {
            // Skip the backup log itself if it exists in source
            if (col.name === '_backup_log')
                continue;
            const docs = await sourceDb.collection(col.name).find({}).toArray();
            if (docs.length > 0) {
                // Drop and re-insert for a clean mirror
                await backupDb.collection(col.name).drop().catch(() => { }); // ignore if doesn't exist
                await backupDb.collection(col.name).insertMany(docs);
            }
            stats.push({ collection: col.name, count: docs.length });
            logger_1.logger.info(`[Backup] Remote: ${col.name} → ${docs.length} docs`);
        }
        // Write a log entry so you can see when the last backup ran
        await backupDb.collection('_backup_log').insertOne({
            backedUpAt: timestamp,
            collections: stats,
            totalCollections: collections.length,
            totalDocs: stats.reduce((sum, s) => sum + s.count, 0),
        });
        logger_1.logger.info(`[Backup] Remote MongoDB backup complete ✅ (${stats.length} collections)`);
    }
    finally {
        await backupConn.close();
    }
}
// ─── Combined Backup Runner ───────────────────────────────────────────────────
async function runBackup() {
    const results = await Promise.allSettled([
        runLocalBackup(),
        runRemoteMongoBackup(),
    ]);
    for (const result of results) {
        if (result.status === 'rejected') {
            logger_1.logger.error('[Backup] One backup target failed:', result.reason?.message ?? result.reason);
        }
    }
}
// ─── Scheduler ────────────────────────────────────────────────────────────────
function setupDailyBackup() {
    if (process.env.NODE_ENV !== 'production') {
        logger_1.logger.info('[Backup] Skipped (development mode)');
        return;
    }
    logger_1.logger.info('[Backup] Daily scheduler initialized (local zip + remote MongoDB)');
    // First run 60 seconds after startup
    setTimeout(async () => {
        try {
            await runBackup();
            cleanOldBackups();
        }
        catch (error) {
            logger_1.logger.error('[Backup] Initial backup failed:', error);
        }
    }, 60000);
    // Then every 24 hours
    setInterval(async () => {
        try {
            await runBackup();
            cleanOldBackups();
        }
        catch (error) {
            logger_1.logger.error('[Backup] Scheduled backup failed:', error);
        }
    }, TWENTY_FOUR_HOURS_MS);
}
//# sourceMappingURL=backup.js.map