// Universal Piece Moderation Bot - Database Handler
const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ CRITICAL ERROR: No database URL found in .env');
}

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
});

const db = {
    query: (text, params) => pool.query(text, params),

    ensureTables: async () => {
        console.log('🔄 Checking database tables...');

        const createModlogsTable = `
            CREATE TABLE IF NOT EXISTS modlogs (
                id SERIAL PRIMARY KEY,
                caseid TEXT UNIQUE NOT NULL,
                guildid TEXT NOT NULL,
                userid TEXT NOT NULL,
                usertag TEXT,
                moderatorid TEXT NOT NULL, 
                moderatortag TEXT,
                action TEXT NOT NULL,
                reason TEXT,
                timestamp BIGINT NOT NULL,
                dmstatus TEXT,  
                status TEXT DEFAULT 'ACTIVE',
                endsAt BIGINT,
                action_duration TEXT,
                appealable BOOLEAN DEFAULT TRUE,
                proof TEXT,
                unban_timestamp BIGINT,
                logmessageid TEXT
            );`;
            
        const createLogChannelsTable = `CREATE TABLE IF NOT EXISTS log_channels (id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, log_type TEXT NOT NULL, channel_id TEXT, UNIQUE (guildid, log_type));`;
        // Definición actualizada (por si se borra la tabla y se crea de cero)
        const createGuildSettingsTable = `CREATE TABLE IF NOT EXISTS guild_settings (id SERIAL PRIMARY KEY, guildid TEXT UNIQUE NOT NULL, staff_roles TEXT, mod_immunity BOOLEAN DEFAULT TRUE, universal_lock BOOLEAN DEFAULT FALSE);`;
        const createCommandPermissionsTable = `CREATE TABLE IF NOT EXISTS command_permissions (id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, command_name TEXT NOT NULL, role_id TEXT NOT NULL, UNIQUE (guildid, command_name, role_id));`;
        const createAutomodRulesTable = `CREATE TABLE IF NOT EXISTS automod_rules (id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, rule_order INTEGER NOT NULL, warnings_count INTEGER NOT NULL, action_type TEXT NOT NULL, action_duration TEXT, UNIQUE (guildid, warnings_count));`;
        const createAppealsBlacklistTable = `CREATE TABLE IF NOT EXISTS appeal_blacklist (id SERIAL PRIMARY KEY, userid TEXT NOT NULL, guildid TEXT NOT NULL, timestamp BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000, UNIQUE (userid, guildid));`;
        const createPendingAppealsTable = `CREATE TABLE IF NOT EXISTS pending_appeals (userid TEXT NOT NULL, guildid TEXT NOT NULL, appeal_messageid TEXT, timestamp BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000, PRIMARY KEY (userid, guildid));`;
        
        const createGuildBackupsTable = `
            CREATE TABLE IF NOT EXISTS guild_backups (
                guildid VARCHAR(20) PRIMARY KEY,
                data JSONB,
                last_backup BIGINT,
                antinuke_enabled BOOLEAN DEFAULT FALSE,
                threshold_count INT DEFAULT 5,
                threshold_time INT DEFAULT 10
            );
        `;

        const createWhitelistTable = `CREATE TABLE IF NOT EXISTS bot_whitelist (guildid TEXT, targetid TEXT, PRIMARY KEY (guildid, targetid));`;

        await db.query(createModlogsTable);
        await db.query(createLogChannelsTable);
        await db.query(createGuildSettingsTable);
        await db.query(createCommandPermissionsTable);
        await db.query(createAutomodRulesTable);
        await db.query(createAppealsBlacklistTable);
        await db.query(createPendingAppealsTable); 
        await db.query(createGuildBackupsTable); 
        await db.query(createWhitelistTable); 

        // --- ZONA DE REPARACIÓN Y MIGRACIÓN AUTOMÁTICA ---
        try { await db.query(`ALTER TABLE modlogs RENAME COLUMN modid TO moderatorid`); } catch (e) {}
        try { await db.query(`ALTER TABLE log_channels DROP CONSTRAINT IF EXISTS log_channels_guildid_key`); } catch (e) {}
        
        // 🛠️ ESTO ARREGLA TU ERROR: Añade la columna si no existe
        try { 
            await db.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS universal_lock BOOLEAN DEFAULT FALSE`); 
            console.log('✅ Checked/Added universal_lock column.');
        } catch (e) {
            console.log('⚠️ Note regarding universal_lock migration:', e.message);
        }
        // --------------------------------------------------

        console.log('✅ Database repair complete. System ready.');
    }
};

module.exports = db;