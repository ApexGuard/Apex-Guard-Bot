const fs = require('fs');
const path = require('path');
const backuponstart = true;
const DB_PATH = path.join(__dirname, '..', 'DB');
const BACKUP_INTERVAL = 6 * 60 * 60 * 1000;

async function backupDatabaseFiles(client) {
    try {
        const backupChannelId = process.env.BACKUP_CHANNEL_ID;
        if (!backupChannelId) {
            console.error('[Apex Backup] BACKUP_CHANNEL_ID not set in .env');
            return;
        }

        const channel = await client.channels.fetch(backupChannelId);
        if (!channel) {
            console.error('[Apex Backup] Backup channel not found');
            return;
        }

        const files = fs.readdirSync(DB_PATH).filter(file => 
            file.endsWith('.json')
        );

        if (files.length === 0) {
            console.log('[Apex Backup] No database files to backup');
            return;
        }

        console.log(`\n📦 [APEX BACKUP] Starting backup of ${files.length} file(s)...`);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let successCount = 0;

        for (const file of files) {
            try {
                const filePath = path.join(DB_PATH, file);
                const fileSize = fs.statSync(filePath).size;

                await channel.send({
                    content: `🔄 Backup: \`${file}\` (${(fileSize / 1024).toFixed(2)} KB)`,
                    files: [filePath]
                });

                successCount++;
                console.log(`   ✅ ${file} backed up`);
            } catch (err) {
                console.error(`   ❌ Failed to backup ${file}:`, err.message);
            }
        }

        console.log(`📦 [APEX BACKUP] Completed: ${successCount}/${files.length} files\n`);

    } catch (err) {
        console.error('[Apex Backup] Error:', err.message);
    }
}

module.exports = (client) => {
    console.log('[Apex] Backup system initialized - Running every 6 hours');

    if (backuponstart) {
        client.on('clientReady', () => {
            console.log('[Apex Backup] Bot ready - Starting first backup...');
            backupDatabaseFiles(client);
        });
    }

    setInterval(() => {
        backupDatabaseFiles(client);
    }, BACKUP_INTERVAL);
};
