const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 0,
});

pool.on('error', (err, client) => {
    console.error('❌ Unexpected error on idle client', err);
});

const db = {
    query: async (text, params = [], silent = false) => {
        try {
            return await pool.query(text, params);
        } catch (error) {
            if (!silent) {
                console.error(`❌ Database Query Error: ${error.message} | Query: ${text}`);
            }
            throw error;
        }
    },

    ensureTables: async () => {
        console.log('🔄 Creando tablas si no existen y verificando integridad de base de datos...');
        
        await db.query(`CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT);`);
        
        await db.query(`
            CREATE TABLE IF NOT EXISTS modlogs (
                id SERIAL PRIMARY KEY, caseid TEXT UNIQUE NOT NULL, guildid TEXT NOT NULL, 
                userid TEXT NOT NULL, usertag TEXT, moderatorid TEXT NOT NULL, moderatortag TEXT, 
                action TEXT NOT NULL, reason TEXT, timestamp BIGINT NOT NULL, dmstatus TEXT, 
                status TEXT DEFAULT 'ACTIVE', endsat BIGINT, action_duration TEXT, 
                appealable BOOLEAN DEFAULT TRUE, logmessageid TEXT, proof TEXT, unban_timestamp BIGINT
            );
        `);

        await db.query(`CREATE TABLE IF NOT EXISTS log_channels (id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, log_type TEXT NOT NULL, channel_id TEXT, UNIQUE (guildid, log_type));`);
        await db.query(`CREATE TABLE IF NOT EXISTS guild_settings (id SERIAL PRIMARY KEY, guildid TEXT UNIQUE NOT NULL, staff_roles TEXT, mod_immunity BOOLEAN DEFAULT TRUE, universal_lock BOOLEAN DEFAULT FALSE, prefix TEXT DEFAULT '!', delete_prefix_cmd_message BOOLEAN DEFAULT FALSE, log_channel_id TEXT);`);
        await db.query(`CREATE TABLE IF NOT EXISTS command_permissions (id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, command_name TEXT NOT NULL, role_id TEXT NOT NULL, UNIQUE (guildid, command_name, role_id));`);
        await db.query(`CREATE TABLE IF NOT EXISTS automod_rules (id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, rule_order INTEGER NOT NULL, warnings_count INTEGER NOT NULL, action_type TEXT NOT NULL, action_duration TEXT, UNIQUE (guildid, warnings_count));`);
        await db.query(`CREATE TABLE IF NOT EXISTS automod_protections (guildid TEXT PRIMARY KEY, antimention_roles TEXT[], antimention_bypass TEXT[], antispam JSONB);`);
        
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

        await db.query(`
            CREATE TABLE IF NOT EXISTS custom_commands (
                id SERIAL PRIMARY KEY,
                guildid TEXT NOT NULL,
                name TEXT NOT NULL,
                response_json TEXT NOT NULL,
                allowed_roles TEXT, 
                created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
                UNIQUE (guildid, name)
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS transcripts (
                ticket_id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                closed_by TEXT,
                closed_at BIGINT,
                messages JSONB NOT NULL
            );`);

        await db.query(`
            CREATE TABLE IF NOT EXISTS ban_appeals (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                reason TEXT,
                status TEXT DEFAULT 'PENDING',
                message_id TEXT,
                timestamp BIGINT,
                source TEXT DEFAULT 'DISCORD'
            );`);

      
        try { await db.query(`ALTER TABLE modlogs RENAME COLUMN modid TO moderatorid`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN moderatorid TEXT`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN dmstatus TEXT`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN action_duration TEXT`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN alertable BOOLEAN DEFAULT TRUE`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN logmessageid TEXT`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN proof TEXT`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN unban_timestamp BIGINT`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs RENAME COLUMN "endsAt" TO endsat;`, [], true); } catch (e) {}
        
        try { await db.query(`ALTER TABLE guild_settings ADD COLUMN universal_lock BOOLEAN DEFAULT FALSE`, [], true); } catch (e) {}
        console.log('✅ Columna universal_lock - OK');
        try { await db.query(`ALTER TABLE guild_settings ADD COLUMN prefix TEXT DEFAULT '!'`, [], true); } catch (e) {}
        console.log('✅ Columna prefix - OK');
        try { await db.query(`ALTER TABLE guild_settings ADD COLUMN delete_prefix_cmd_message BOOLEAN DEFAULT FALSE`, [], true); } catch (e) {}
        console.log('✅ Columna delete_prefix_cmd_message - OK');
        try { await db.query(`ALTER TABLE guild_settings ADD COLUMN log_channel_id TEXT`, [], true); } catch (e) {}
        console.log('✅ Columna log_channel_id - OK'); 

        try { await db.query(`ALTER TABLE guild_backups ADD COLUMN antinuke_ignore_supreme BOOLEAN DEFAULT TRUE`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE guild_backups ADD COLUMN antinuke_ignore_verified BOOLEAN DEFAULT TRUE`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE guild_backups ADD COLUMN antinuke_action TEXT DEFAULT 'ban'`, [], true); } catch (e) {}

        try { await db.query(`ALTER TABLE log_channels DROP CONSTRAINT log_channels_guildid_key`, [], true); } catch (e) {}

        try { await db.query(`ALTER TABLE ticket_panels ADD COLUMN ticket_limit INTEGER DEFAULT 1`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE ticket_panels ADD COLUMN welcome_color TEXT DEFAULT '#5865F2'`, [], true); } catch (e) {} 
        try { await db.query(`ALTER TABLE ticket_panels ADD COLUMN panel_color TEXT DEFAULT '#5865F2'`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE ticket_panels ADD COLUMN button_style TEXT DEFAULT 'Primary'`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE ticket_panels ADD COLUMN button_emoji TEXT DEFAULT '📩'`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE ticket_panels ADD COLUMN button_label TEXT DEFAULT 'Open Ticket'`, [], true); } catch (e) {}
        
        try { await db.query(`ALTER TABLE custom_commands ADD COLUMN allowed_roles TEXT`, [], true); } catch (e) {}
        try { await db.query(`ALTER TABLE ban_appeals ADD COLUMN source TEXT DEFAULT 'DISCORD'`, [], true); } catch (e) {}

        console.log('✅ PostgreSQL: Todas las tablas y columnas verificadas e inicializadas correctamente.');
    }
};

const keepAlive = () => {
    db.query('SELECT 1;', [], true)
        .then(() => console.log('🔄 Sent keep-alive ping to the database.'))
        .catch(err => console.error('❌ Failed to send keep-alive ping:', err));
};

setInterval(keepAlive, 6 * 60 * 60 * 1000); 

module.exports = db;
