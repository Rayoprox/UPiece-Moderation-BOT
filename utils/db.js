const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

pool.on('error', (err, client) => {
    console.error('❌ Unexpected error on idle client', err);
});

const db = {
    query: async (text, params) => {
        try {
            return await pool.query(text, params);
        } catch (error) {
            console.error(`❌ Database Query Error: ${error.message} | Query: ${text}`);
            throw error;
        }
    },

    ensureTables: async () => {
        await db.query(`CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT);`);
        
        await db.query(`
            CREATE TABLE IF NOT EXISTS modlogs (
                id SERIAL PRIMARY KEY, caseid TEXT UNIQUE NOT NULL, guildid TEXT NOT NULL, 
                userid TEXT NOT NULL, usertag TEXT, moderatorid TEXT NOT NULL, moderatortag TEXT, 
                action TEXT NOT NULL, reason TEXT, timestamp BIGINT NOT NULL, dmstatus TEXT, 
                status TEXT DEFAULT 'ACTIVE', endsAt BIGINT, action_duration TEXT, 
                appealable BOOLEAN DEFAULT TRUE, logmessageid TEXT, proof TEXT, unban_timestamp BIGINT
            );
        `);

        await db.query(`CREATE TABLE IF NOT EXISTS log_channels (id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, log_type TEXT NOT NULL, channel_id TEXT, UNIQUE (guildid, log_type));`);
        await db.query(`CREATE TABLE IF NOT EXISTS guild_settings (id SERIAL PRIMARY KEY, guildid TEXT UNIQUE NOT NULL, staff_roles TEXT, mod_immunity BOOLEAN DEFAULT TRUE, universal_lock BOOLEAN DEFAULT FALSE, prefix TEXT DEFAULT '!');`);
        await db.query(`CREATE TABLE IF NOT EXISTS command_permissions (id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, command_name TEXT NOT NULL, role_id TEXT NOT NULL, UNIQUE (guildid, command_name, role_id));`);
        await db.query(`CREATE TABLE IF NOT EXISTS automod_rules (id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, rule_order INTEGER NOT NULL, warnings_count INTEGER NOT NULL, action_type TEXT NOT NULL, action_duration TEXT, UNIQUE (guildid, warnings_count));`);
        
        await db.query(`CREATE TABLE IF NOT EXISTS appeal_blacklist (id SERIAL PRIMARY KEY, userid TEXT NOT NULL, guildid TEXT NOT NULL, timestamp BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000, UNIQUE (userid, guildid));`);
        await db.query(`CREATE TABLE IF NOT EXISTS pending_appeals (userid TEXT NOT NULL, guildid TEXT NOT NULL, appeal_messageid TEXT, timestamp BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000, PRIMARY KEY (userid, guildid));`);
        await db.query(`CREATE TABLE IF NOT EXISTS guild_backups (guildid TEXT PRIMARY KEY, data JSONB, last_backup BIGINT, antinuke_enabled BOOLEAN DEFAULT FALSE, threshold_count INTEGER DEFAULT 10, threshold_time INTEGER DEFAULT 60);`);
        
        await db.query(`CREATE TABLE IF NOT EXISTS bot_whitelist (guildid TEXT NOT NULL, targetid TEXT NOT NULL, PRIMARY KEY (guildid, targetid));`);
        await db.query(`CREATE TABLE IF NOT EXISTS channel_overwrites (guildid TEXT NOT NULL, channel_id TEXT NOT NULL, overwrites TEXT NOT NULL);`);
        await db.query(`CREATE TABLE IF NOT EXISTS afk_users (guildid TEXT NOT NULL, userid TEXT NOT NULL, reason TEXT, timestamp BIGINT, PRIMARY KEY (guildid, userid));`);
        await db.query(`CREATE TABLE IF NOT EXISTS lockdown_channels (guildid TEXT NOT NULL, channel_id TEXT NOT NULL, PRIMARY KEY (guildid, channel_id));`);
        await db.query(`CREATE TABLE IF NOT EXISTS lockdown_backups (guildid TEXT NOT NULL, channel_id TEXT NOT NULL, permissions_json TEXT NOT NULL, PRIMARY KEY (guildid, channel_id));`);

        await db.query(`
            CREATE TABLE IF NOT EXISTS ticket_panels (
                id SERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                panel_id TEXT NOT NULL,
                title TEXT DEFAULT 'Support Ticket',
                description TEXT DEFAULT 'Click below to open a ticket.',
                banner_url TEXT,
                button_label TEXT DEFAULT 'Open Ticket',
                button_style TEXT DEFAULT 'Primary',
                button_emoji TEXT DEFAULT '📩',
                panel_color TEXT DEFAULT '#5865F2',
                welcome_color TEXT DEFAULT '#5865F2',
                support_role_id TEXT,
                blacklist_role_id TEXT,
                ticket_category_id TEXT,
                log_channel_id TEXT,
                welcome_message TEXT DEFAULT 'Hello {user}, staff will be with you shortly.',
                ticket_limit INTEGER DEFAULT 1,
                created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
                UNIQUE (guild_id, panel_id)
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS tickets (
                id SERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                channel_id TEXT UNIQUE NOT NULL,
                user_id TEXT NOT NULL,
                panel_id TEXT,
                status TEXT DEFAULT 'OPEN',
                created_at BIGINT NOT NULL,
                closed_at BIGINT,
                closed_by TEXT,
                close_reason TEXT,
                participants TEXT
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS licenses (
                key TEXT PRIMARY KEY,
                guild_id TEXT UNIQUE,
                redeemed_by TEXT,
                created_at BIGINT,
                expires_at BIGINT,
                type TEXT DEFAULT 'lifetime'
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS generated_licenses (
                license_key TEXT PRIMARY KEY,
                duration_days INTEGER,
                created_at BIGINT
            );
        `);

        try { await db.query(`ALTER TABLE modlogs RENAME COLUMN modid TO moderatorid`); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN moderatorid TEXT`); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN dmstatus TEXT`); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN action_duration TEXT`); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN appealable BOOLEAN DEFAULT TRUE`); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN logmessageid TEXT`); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN proof TEXT`); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN unban_timestamp BIGINT`); } catch (e) {}
        
        try { await db.query(`ALTER TABLE guild_settings ADD COLUMN universal_lock BOOLEAN DEFAULT FALSE`); } catch (e) {}
        try { await db.query(`ALTER TABLE guild_settings ADD COLUMN prefix TEXT DEFAULT '!'`); } catch (e) {}
        try { await db.query(`ALTER TABLE log_channels DROP CONSTRAINT log_channels_guildid_key`); } catch (e) {}

        try { await db.query(`ALTER TABLE ticket_panels ADD COLUMN ticket_limit INTEGER DEFAULT 1`); } catch (e) {}
        try { await db.query(`ALTER TABLE ticket_panels ADD COLUMN welcome_color TEXT DEFAULT '#5865F2'`); } catch (e) {} 
        try { await db.query(`ALTER TABLE ticket_panels ADD COLUMN panel_color TEXT DEFAULT '#5865F2'`); } catch (e) {}
        try { await db.query(`ALTER TABLE ticket_panels ADD COLUMN button_style TEXT DEFAULT 'Primary'`); } catch (e) {}
        try { await db.query(`ALTER TABLE ticket_panels ADD COLUMN button_emoji TEXT DEFAULT '📩'`); } catch (e) {}
        try { await db.query(`ALTER TABLE ticket_panels ADD COLUMN button_label TEXT DEFAULT 'Open Ticket'`); } catch (e) {}
        
        console.log('✅ PostgreSQL Database Integrity Check Completed.');
    }
};

module.exports = db;