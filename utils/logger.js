const { createLogger, format, transports } = require('winston');
const { WebhookClient } = require('discord.js');
const db = require('./db.js');

let webhookClient = null;

const MIRROR_CONSOLE = process.env.MIRROR_CONSOLE === 'true';

const transportsList = [];
if (!MIRROR_CONSOLE) {
    transportsList.push(new transports.Console({ format: format.combine(format.colorize(), format.simple()) }));
}

const winstonLogger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.splat(),
        format.json()
    ),
    transports: transportsList,
});

const levelsToWrap = ['error', 'warn', 'info'];
const formatArgsForSend = (args) => args.map(a => {
    if (a instanceof Error) return a.stack;
    if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch (_) { return String(a); }
    }
    return String(a);
}).join(' ');

for (const lvl of levelsToWrap) {
    if (typeof winstonLogger[lvl] === 'function') {
        const original = winstonLogger[lvl].bind(winstonLogger);
        winstonLogger[lvl] = (...args) => {
            try { original(...args); } catch (_) { }
            try { sendToDiscord(lvl, formatArgsForSend(args)); } catch (_) { }
        };
    }
}

const originalConsoleLog = console.log.bind(console);
const originalConsoleWarn = console.warn.bind(console);
const originalConsoleError = console.error.bind(console);
const originalConsoleInfo = console.info ? console.info.bind(console) : originalConsoleLog;
const originalConsoleDebug = console.debug ? console.debug.bind(console) : originalConsoleLog;
const originalConsoleTrace = console.trace ? console.trace.bind(console) : originalConsoleLog;

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

let bufferedLogs = [];
let stdoutBuffer = '';
let stderrBuffer = '';
let _sendingToWebhook = false;

const pushOrSend = (level, text) => {
    const allowed = new Set(['log', 'info', 'warn', 'error']);
    if (!allowed.has(level)) return;
    try {
        if (webhookClient && !_sendingToWebhook) {
            sendToDiscord(level, text);
        } else {
            bufferedLogs.push({ level, text });
        }
    } catch (e) {
        try { bufferedLogs.push({ level, text }); } catch (_) { }
    }
};

const formatArgs = (args) => args.map(a => {
    if (a instanceof Error) return a.stack;
    if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch (_) { return String(a); }
    }
    return String(a);
}).join(' ');

console.log = (...args) => { originalConsoleLog(...args); pushOrSend('log', formatArgs(args)); };
console.info = (...args) => { originalConsoleInfo(...args); pushOrSend('info', formatArgs(args)); };
console.debug = (...args) => { originalConsoleDebug(...args); };
console.trace = (...args) => { originalConsoleTrace(...args); };
console.warn = (...args) => { originalConsoleWarn(...args); pushOrSend('warn', formatArgs(args)); };
console.error = (...args) => { originalConsoleError(...args); pushOrSend('error', formatArgs(args)); };

process.stdout.write = (chunk, encoding, cb) => {
    try { originalStdoutWrite(chunk, encoding, cb); } catch (_) {}
    try {
        const str = typeof chunk === 'string' ? chunk : chunk.toString(encoding);
        stdoutBuffer += str;
        let idx;
        while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
            const line = stdoutBuffer.slice(0, idx);
            stdoutBuffer = stdoutBuffer.slice(idx + 1);
            pushOrSend('log', line);
        }
    } catch (_) {}
    return true;
};

process.stderr.write = (chunk, encoding, cb) => {
    try { originalStderrWrite(chunk, encoding, cb); } catch (_) {}
    try {
        const str = typeof chunk === 'string' ? chunk : chunk.toString(encoding);
        stderrBuffer += str;
        let idx;
        while ((idx = stderrBuffer.indexOf('\n')) !== -1) {
            const line = stderrBuffer.slice(0, idx);
            stderrBuffer = stderrBuffer.slice(idx + 1);
            pushOrSend('error', line);
        }
    } catch (_) {}
    return true;
};

const sendToDiscord = async (level, message) => {
    if (!webhookClient) return;
    try {
        if (_sendingToWebhook) return;
        _sendingToWebhook = true;

        const colors = { error: 0xff5c5c, warn: 0xffb86b, info: 0x69c0ff, log: 0xa6e22e };
        const emojis = { error: '❌', warn: '⚠️', info: 'ℹ️', log: 'ℹ️' };
        const text = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
        const safeText = text.length > 3800 ? text.slice(0, 3800) + '\n... (truncated)' : text;

        const embed = {
            title: `${emojis[level] || 'ℹ️'} ${level.toUpperCase()} - Console`,
            description: '```\n' + safeText + '\n```',
            color: colors[level] || colors.info,
            timestamp: new Date().toISOString(),
        };

        await webhookClient.send({ username: 'Console Mirror', embeds: [embed] });
    } catch (err) {
        try {
            if (err && err.code === 10015) webhookClient = null;
        } catch (e) { webhookClient = null; }
    } finally {
        _sendingToWebhook = false;
    }
};

const initLogger = async () => {
    try {
        const res = await db.query("SELECT value FROM global_settings WHERE key = 'logger_webhook'");
        if (res.rows.length > 0) {
            webhookClient = new WebhookClient({ url: res.rows[0].value });
            // send a small test message to verify webhook is valid
            try {
                await webhookClient.send({ username: 'Bot Logger', content: '✅ Logger webhook test message (initialization).' });
                winstonLogger.info('🚀 [LOGGER] Webhook linked and active. Test message sent.');
            } catch (err) {
                originalConsoleError('❌ [LOGGER] Failed to send test message to webhook:', err && err.message ? err.message : err);
                // if sending fails, disable webhookClient to avoid further errors
                webhookClient = null;
            }
        }
    } catch (e) {
        winstonLogger.error('❌ [LOGGER] Failed to initialize from DB: %s', e.message);
    }
    // Fallback to environment variable if DB doesn't have webhook
    if (!webhookClient && process.env.LOGGER_WEBHOOK) {
        try {
            webhookClient = new WebhookClient({ url: process.env.LOGGER_WEBHOOK });
            // Use console directly to ensure visibility even if transports are disabled
            originalConsoleLog('🚀 [LOGGER] Webhook linked from LOGGER_WEBHOOK env var.');
        } catch (e) {
            originalConsoleError('❌ [LOGGER] Failed to initialize webhook from env var:', e.message);
            webhookClient = null;
        }
    }
    if (!webhookClient) {
        originalConsoleLog('ℹ️ [LOGGER] No webhook configured (DB or LOGGER_WEBHOOK).');
    }
    // flush any buffered logs now that webhook may be available
    if (webhookClient && bufferedLogs.length > 0) {
        for (const entry of bufferedLogs) {
            try { await sendToDiscord(entry.level, entry.text); } catch (_) { }
        }
        bufferedLogs = [];
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
        winstonLogger.error('Failed to set webhook: %s', e.message);
        return false;
    }
};

const log = (msg, ...meta) => {
    winstonLogger.info(msg, ...meta);
    sendToDiscord('log', typeof msg === 'string' ? msg : { msg, meta });
};

const info = (msg, ...meta) => {
    winstonLogger.info(msg, ...meta);
    sendToDiscord('info', typeof msg === 'string' ? msg : { msg, meta });
};

const warn = (msg, ...meta) => {
    winstonLogger.warn(msg, ...meta);
    sendToDiscord('warn', typeof msg === 'string' ? msg : { msg, meta });
};

const error = (msg, ...meta) => {
    winstonLogger.error(msg, ...meta);
    sendToDiscord('error', typeof msg === 'string' ? msg : { msg, meta });
};

module.exports = { winstonLogger, initLogger, setWebhook, log, info, warn, error };