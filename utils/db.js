// utils/db.js

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL, 
    ssl: {
        rejectUnauthorized: false
    }
});

const db = {
    query: (text, params) => {
        return pool.query(text, params);
    },

    ensureTables: async () => {
        console.log('🔄 Checking database integrity & patching schema...');

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
                logmessageid TEXT,
                proof TEXT,
                unban_timestamp BIGINT
            );`;
            
        const createLogChannelsTable = `
            CREATE TABLE IF NOT EXISTS log_channels (
                id SERIAL PRIMARY KEY, 
                guildid TEXT NOT NULL, 
                log_type TEXT NOT NULL, 
                channel_id TEXT, 
                UNIQUE (guildid, log_type)
            );`;

        const createGuildSettingsTable = `
            CREATE TABLE IF NOT EXISTS guild_settings (
                id SERIAL PRIMARY KEY, 
                guildid TEXT UNIQUE NOT NULL, 
                staff_roles TEXT, 
                mod_immunity BOOLEAN DEFAULT TRUE,
                universal_lock BOOLEAN DEFAULT FALSE
            );`;

        const createCommandPermissionsTable = `
            CREATE TABLE IF NOT EXISTS command_permissions (
                id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, command_name TEXT NOT NULL, role_id TEXT NOT NULL, UNIQUE (guildid, command_name, role_id)
            );`;

        const createAutomodRulesTable = `
            CREATE TABLE IF NOT EXISTS automod_rules (
                id SERIAL PRIMARY KEY, guildid TEXT NOT NULL, rule_order INTEGER NOT NULL, warnings_count INTEGER NOT NULL, action_type TEXT NOT NULL, action_duration TEXT, UNIQUE (guildid, warnings_count)
            );`;

        const createAppealsBlacklistTable = `
            CREATE TABLE IF NOT EXISTS appeal_blacklist (
                id SERIAL PRIMARY KEY, userid TEXT NOT NULL, guildid TEXT NOT NULL, timestamp BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000, UNIQUE (userid, guildid)
            );`;

        const createPendingAppealsTable = `
            CREATE TABLE IF NOT EXISTS pending_appeals (
                userid TEXT NOT NULL,
                guildid TEXT NOT NULL,
                appeal_messageid TEXT,
                timestamp BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
                PRIMARY KEY (userid, guildid)
            );`;

        const createGuildBackupsTable = `
            CREATE TABLE IF NOT EXISTS guild_backups (
                guildid TEXT PRIMARY KEY,
                data JSONB,
                last_backup BIGINT,
                antinuke_enabled BOOLEAN DEFAULT FALSE,
                threshold_count INTEGER DEFAULT 10,
                threshold_time INTEGER DEFAULT 60
            );`;

        const createBotWhitelistTable = `
            CREATE TABLE IF NOT EXISTS bot_whitelist (
                guildid TEXT NOT NULL,
                targetid TEXT NOT NULL,
                PRIMARY KEY (guildid, targetid)
            );`;


        const createChannelOverwritesTable = `
            CREATE TABLE IF NOT EXISTS channel_overwrites (
                guildid TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                overwrites TEXT NOT NULL
            );`;

            const createTicketPanelsTable = `
            CREATE TABLE IF NOT EXISTS ticket_panels (
                id SERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                panel_id TEXT NOT NULL, -- ID único interno (ej: "panel-1234")
                title TEXT DEFAULT 'Support Ticket',
                description TEXT DEFAULT 'Click the button below to open a ticket.',
                banner_url TEXT,
                button_label TEXT DEFAULT 'Open Ticket',
                button_style TEXT DEFAULT 'Primary', -- Primary (Azul), Secondary (Gris), Success (Verde), Danger (Rojo)
                button_emoji TEXT DEFAULT '📩',
                support_role_id TEXT,
                blacklist_role_id TEXT,
                ticket_category_id TEXT,
                log_channel_id TEXT,
                welcome_message TEXT DEFAULT 'Hello {user}, staff will be with you shortly.',
                created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
                UNIQUE (guild_id, panel_id)
            );`;

        const createTicketsTable = `
            CREATE TABLE IF NOT EXISTS tickets (
                id SERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                channel_id TEXT UNIQUE NOT NULL, -- El canal del ticket
                user_id TEXT NOT NULL, -- El dueño del ticket
                panel_id TEXT, -- De qué panel vino (para saber qué logs usar)
                status TEXT DEFAULT 'OPEN', -- OPEN, CLOSED
                created_at BIGINT NOT NULL,
                closed_at BIGINT,
                closed_by TEXT,
                close_reason TEXT,
                participants TEXT -- Guardaremos un JSON string de los IDs de staff que hablaron
            );`;

        await db.query(createTicketPanelsTable);
        await db.query(createTicketsTable);
        await db.query(createModlogsTable);
        await db.query(createLogChannelsTable);
        await db.query(createGuildSettingsTable);
        await db.query(createCommandPermissionsTable);
        await db.query(createAutomodRulesTable);
        await db.query(createAppealsBlacklistTable);
        await db.query(createPendingAppealsTable);
        await db.query(createGuildBackupsTable);
        await db.query(createBotWhitelistTable);
        await db.query(createChannelOverwritesTable);


     
        try { await db.query(`ALTER TABLE modlogs RENAME COLUMN modid TO moderatorid`); } catch (e) {}

        try { await db.query(`ALTER TABLE modlogs ADD COLUMN moderatorid TEXT`); } catch (e) {}

      
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN dmstatus TEXT`); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN action_duration TEXT`); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN appealable BOOLEAN DEFAULT TRUE`); } catch (e) {}
        try { await db.query(`ALTER TABLE modlogs ADD COLUMN logmessageid TEXT`); } catch (e) {}

      
        try { 
            await db.query(`ALTER TABLE modlogs ADD COLUMN proof TEXT`);
            console.log("✅ FIXED: Column 'proof' added to modlogs.");
        } catch (e) {}
        
        try { 
            await db.query(`ALTER TABLE modlogs ADD COLUMN unban_timestamp BIGINT`);
            console.log("✅ FIXED: Column 'unban_timestamp' added to modlogs.");
        } catch (e) {}

        try { 
            await db.query(`ALTER TABLE guild_settings ADD COLUMN universal_lock BOOLEAN DEFAULT FALSE`);
            console.log("✅ FIXED: Column 'universal_lock' added to guild_settings.");
        } catch (e) {}

       
        try {
            await db.query(`ALTER TABLE log_channels DROP CONSTRAINT log_channels_guildid_key`);
        } catch (e) {}
         console.log('✅ Ticket System tables ensured.');

        console.log('✅ PostgreSQL Database Integrity Check Completed & Tables Ensured.');
    }
};

module.exports = db;