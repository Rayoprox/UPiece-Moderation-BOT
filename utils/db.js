// Universal Piece Moderation Bot - Database Handler (Complete Schema Repair & Anti-Nuke)
const { Pool } = require('pg');
require('dotenv').config();

// 1. Lógica de Conexión Inteligente (Evita errores si cambia el nombre de la variable)
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ CRITICAL ERROR: No database URL found in .env (POSTGRES_URL or DATABASE_URL is missing).');
}

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
});

const db = {
    query: (text, params) => pool.query(text, params),

    ensureTables: async () => {
        console.log('🔄 Performing deep database health check...');

        // --- 1. Full Schema Definitions (For new tables) ---
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
        const createGuildSettingsTable = `CREATE TABLE IF NOT EXISTS guild_settings (id SERIAL PRIMARY KEY, guildid TEXT UNIQUE NOT NULL, staff_roles TEXT, mod_immunity BOOLEAN DEFAULT TRUE);`;
        const createCommandPermissionsTable = `CREATE TABLE IF NOT EXISTS command_permissions (id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, command_name TEXT NOT NULL, role_id TEXT NOT NULL, UNIQUE (guildid, command_name, role_id));`;
        const createAutomodRulesTable = `CREATE TABLE IF NOT EXISTS automod_rules (id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, rule_order INTEGER NOT NULL, warnings_count INTEGER NOT NULL, action_type TEXT NOT NULL, action_duration TEXT, UNIQUE (guildid, warnings_count));`;
        const createAppealsBlacklistTable = `CREATE TABLE IF NOT EXISTS appeal_blacklist (id SERIAL PRIMARY KEY, userid TEXT NOT NULL, guildid TEXT NOT NULL, timestamp BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000, UNIQUE (userid, guildid));`;
        const createPendingAppealsTable = `CREATE TABLE IF NOT EXISTS pending_appeals (userid TEXT NOT NULL, guildid TEXT NOT NULL, appeal_messageid TEXT, timestamp BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000, PRIMARY KEY (userid, guildid));`;
        
        // --- NUEVA TABLA ANTI-NUKE ---
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

        // Create Tables
        await db.query(createModlogsTable);
        await db.query(createLogChannelsTable);
        await db.query(createGuildSettingsTable);
        await db.query(createCommandPermissionsTable);
        await db.query(createAutomodRulesTable);
        await db.query(createAppealsBlacklistTable);
        await db.query(createPendingAppealsTable); 
        await db.query(createGuildBackupsTable); // Crear tabla de backups

        // --- 2. The "Repair All" Logic ---
        
        // A. Rename legacy columns
        try {
            await db.query(`ALTER TABLE modlogs RENAME COLUMN modid TO moderatorid`);
            console.log("🛠️  [FIX] Renamed 'modid' to 'moderatorid'.");
        } catch (e) { /* Ignore */ }

        // B. Remove Setup Constraints
        try {
            await db.query(`ALTER TABLE log_channels DROP CONSTRAINT IF EXISTS log_channels_guildid_key`);
        } catch (e) { /* Ignore */ }

        // C. Force-Create ALL required columns
        const allColumns = [
            { name: 'dmstatus', type: 'TEXT' },
            { name: 'action_duration', type: 'TEXT' },
            { name: 'appealable', type: 'BOOLEAN DEFAULT TRUE' },
            { name: 'proof', type: 'TEXT' },
            { name: 'endsAt', type: 'BIGINT' },
            { name: 'unban_timestamp', type: 'BIGINT' }, 
            { name: 'moderatorid', type: 'TEXT' },
            { name: 'logmessageid', type: 'TEXT' },
            { name: 'status', type: "TEXT DEFAULT 'ACTIVE'" }
        ];

        console.log("🔍 Scanning columns...");
        for (const col of allColumns) {
            try {
                await db.query(`ALTER TABLE modlogs ADD COLUMN ${col.name} ${col.type}`);
                console.log(`✅ [FIX] Added missing column: ${col.name}`);
            } catch (e) {
                // Ignore "duplicate column" errors (42701)
                if (e.code !== '42701') console.warn(`   [INFO] Check ${col.name}: ${e.message}`);
            }
        }
        
        console.log('✅ Database repair complete. System ready.');
    }
};

module.exports = db;