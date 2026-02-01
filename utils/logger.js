const { WebhookClient, EmbedBuilder } = require('discord.js');
const db = require('./db.js');

let loggerWebhook = null;

async function sendToDiscord(content, type = 'INFO') {
    if (!loggerWebhook) return;
    const colors = { INFO: '#0099ff', ERROR: '#ff0000', WARN: '#ffff00' };
    
    try {
        const text = content.toString().slice(0, 2000);
        const embed = new EmbedBuilder()
            .setTitle(`📡 Console [${type}]`)
            .setDescription(`\`\`\`js\n${text}\n\`\`\``)
            .setColor(colors[type] || '#0099ff')
            .setTimestamp();

        await loggerWebhook.send({ embeds: [embed] });
    } catch (err) {
    }
}

module.exports = {
    setWebhook: async (url) => {
        try {
            const client = new WebhookClient({ url });
            await db.query(`
                INSERT INTO guild_settings (guildid, log_channel_id) 
                VALUES ('GLOBAL_LOGGER', $1) 
                ON CONFLICT (guildid) DO UPDATE SET log_channel_id = $1`, 
                [url]
            );
            loggerWebhook = client;
            return true;
        } catch (e) { return false; }
    },

    initLogger: async () => {
        try {
            const res = await db.query("SELECT log_channel_id FROM guild_settings WHERE guildid = 'GLOBAL_LOGGER'");
            if (res.rows[0]?.log_channel_id) {
                loggerWebhook = new WebhookClient({ url: res.rows[0].log_channel_id });
                console.log("✅ Persistent Logger Loaded");
            }

            const originalLog = console.log;
            const originalError = console.error;

            console.log = (...args) => {
                originalLog(...args);
                sendToDiscord(args.join(' '), 'INFO');
            };

            console.error = (...args) => {
                originalError(...args);
                sendToDiscord(args.join(' '), 'ERROR');
            };
        } catch (err) {
            console.log("⚠️ Logger start skipped (DB not ready yet)");
        }
    }
};