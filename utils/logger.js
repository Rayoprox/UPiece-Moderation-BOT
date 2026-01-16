const { WebhookClient } = require('discord.js');
const db = require('./db.js');

let webhookClient = null;

const sendToDiscord = async (type, args) => {
    if (!webhookClient) return;

    const message = args.map(arg => {
        if (arg instanceof Error) return `${arg.stack}${arg.code ? `\nCode: ${arg.code}` : ''}`;
        return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
    }).join(' ');

    const emoji = type === 'error' ? '❌' : type === 'warn' ? '⚠️' : 'ℹ️';
    const finalMessage = `**${emoji} [${type.toUpperCase()}]**\n\`\`\`js\n${message.substring(0, 1900)}\n\`\`\``;

    try {
        await webhookClient.send({ username: 'Console Mirror', content: finalMessage });
    } catch (err) {
        if (err.code === 10015) webhookClient = null;
    }
};


const initLogger = async () => {
    try {
        const res = await db.query("SELECT value FROM global_settings WHERE key = 'logger_webhook'");
        if (res.rows.length > 0) {
            webhookClient = new WebhookClient({ url: res.rows[0].value });
            console.log("🚀 [LOGGER] Console Mirror linked and active.");
        }
    } catch (e) {
 
        console.error("❌ [LOGGER] Failed to initialize from DB:", e.message);
    }
};

const setWebhook = async (url) => {
    try {
        webhookClient = new WebhookClient({ url });
        await db.query(`
            INSERT INTO global_settings (key, value) 
            VALUES ('logger_webhook', $1) 
            ON CONFLICT (key) DO UPDATE SET value = $1`, 
        [url]);
        return true;
    } catch (e) {
        return false;
    }
};

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => { originalLog(...args); sendToDiscord('log', args); };
console.error = (...args) => { originalError(...args); sendToDiscord('error', args); };
console.warn = (...args) => { originalWarn(...args); sendToDiscord('warn', args); };

module.exports = { setWebhook, initLogger };