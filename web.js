const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const { join } = require('path');
const { EmbedBuilder, PermissionsBitField, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const db = require('./utils/db');
const { SUPREME_IDS } = require('./utils/config');

const app = express();

app.set('trust proxy', 1);

const SCOPES = ['identify', 'guilds'];

function isValidEmoji(emoji) {
    if (!emoji) return false;
    const unicodeRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/;
    const customRegex = /<?(a)?:?(\w{2,32}):(\d{17,19})>?/;
    const idRegex = /^\d{17,19}$/;
    return unicodeRegex.test(emoji) || customRegex.test(emoji) || idRegex.test(emoji);
}

function isValidHexColor(color) {
    return /^#[0-9A-Fa-f]{6}$|^#[0-9A-Fa-f]{3}$/.test(color);
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new Strategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: SCOPES
}, (accessToken, refreshToken, profile, done) => {
    process.nextTick(() => done(null, profile));
}));

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

const isProduction = process.env.NODE_ENV === 'production';

app.use(session({
    name: `session_${(process.env.DISCORD_CLIENT_ID || 'default').slice(-5)}`,
    secret: process.env.SESSION_SECRET || 'rayus_secret_master',
    resave: false,
    saveUninitialized: false,
    proxy: true, 
    cookie: {
        secure: isProduction,   
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7 
    }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
    if (req.path.includes('/auth')) return next();
    next();
});

app.get('/auth/discord', passport.authenticate('discord', { scope: SCOPES }));

app.get('/auth/discord/appeal', (req, res, next) => {
    req.session.returnTo = '/appeal';
    req.session.save(() => {
        passport.authenticate('discord', { scope: SCOPES })(req, res, next);
    });
});

app.get('/auth/discord/appeal-submit', (req, res, next) => {
    req.session.returnTo = '/appeal/submit';
    req.session.save(() => {
        passport.authenticate('discord', { scope: SCOPES })(req, res, next);
    });
});

app.get('/auth/discord/appeal-status', (req, res, next) => {
    req.session.returnTo = '/appeal/status';
    req.session.save(() => {
        passport.authenticate('discord', { scope: SCOPES })(req, res, next);
    });
});

app.get('/auth/discord/callback', (req, res, next) => {
    passport.authenticate('discord', (err, user, info) => {
        if (err) return res.status(500).send(`Error de Autenticación: ${err.message}`);
        if (!user) return res.redirect('/auth/discord');

        req.logIn(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            const returnTo = req.session.returnTo;
            delete req.session.returnTo;
            return res.redirect(returnTo || '/menu');
        });
    })(req, res, next);
});

app.get('/logout', (req, res) => {
    req.logout(() => {
        req.session.destroy();
        res.redirect('/');
    });
});

const auth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/discord');

const protectRoute = async (req, res, next) => {
    const { botClient } = req.app.locals;
    const userId = req.user.id;
    const targetGuildId = req.params.guildId || req.body.guildId;

    if (!targetGuildId) return next();
    if (SUPREME_IDS.includes(userId)) return next();

    try {
        const mgId = process.env.DISCORD_GUILD_ID;
        
        let universalLock = false;
        
        // Intenta SELECT universal_lock; si no existe, usa fallback
        try {
            const settingsRes = await db.query('SELECT universal_lock FROM guild_settings WHERE guildid = $1', [mgId]);
            universalLock = !!settingsRes.rows[0]?.universal_lock;
        } catch (e) {
            if (e.message?.includes('universal_lock')) {
                console.log('ℹ️  [web.js] Columna universal_lock no existe aún en BD');
            } else {
                throw e;
            }
        }

        const mainGuild = botClient.guilds.cache.get(mgId);
        if (!mainGuild) return res.status(404).send('Server not accessible.');
        const mainGuildName = mainGuild.name;

        const memberInMain = await mainGuild.members.fetch(userId).catch(() => null);
        if (!memberInMain) return res.render('error', { message: `⛔ <b>Access Denied</b><br>You must be a member of <b>${mainGuildName}</b>.` });

        const isAdmin = memberInMain.permissions.has(PermissionsBitField.Flags.Administrator);
        const setupPerms = await db.query("SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = 'setup'", [mgId]);
        const hasSetupRole = setupPerms.rows.some(row => memberInMain.roles.cache.has(row.role_id));

        const banPerms = await db.query("SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = 'ban'", [mgId]);
        const hasBanRole = banPerms.rows.some(row => memberInMain.roles.cache.has(row.role_id));


        if (targetGuildId === mgId) {
            if (universalLock) {
                if (hasSetupRole) return next();
                if (req.xhr || req.headers.accept.indexOf('json') > -1) return res.status(403).json({ error: `⛔ ${mainGuildName} Lockdown Active.` });
                return res.render('error', { message: '⛔ <b>Lockdown Active</b><br>Access restricted by Administration.' });
            } else {
                if (isAdmin || hasSetupRole) return next();
                return res.render('error', { message: '⛔ <b>Access Denied</b><br>Requires <b>Administrator</b> or <b>Setup Permission</b>.' });
            }
        }

        if (targetGuildId === process.env.DISCORD_APPEAL_GUILD_ID) {
            if (universalLock) {
                if (hasSetupRole || hasBanRole) return next();
                return res.render('error', { message: '⛔ <b>Access Denied</b><br>Requires <b>Setup Permission</b> or <b>Ban Permission</b> during Lockdown.' });
            } else {
                if (isAdmin || hasSetupRole || hasBanRole) return next();
                return res.render('error', { message: '⛔ <b>Access Denied</b><br>Requires <b>Administrator</b>, <b>Setup Permission</b>, or <b>Ban Permission</b>.' });
            }
        }

        return res.status(403).send('Invalid Guild Context');

    } catch (err) {
        console.error("Security Error:", err);
        return res.status(500).send("Internal Security Error");
    }
};


app.get('/', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/menu');
    const { botClient } = req.app.locals;
    const mainGuild = botClient?.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    const serverName = mainGuild?.name || 'this server';
    const serverIcon = mainGuild?.iconURL({ extension: 'png', size: 256 }) || null;
    res.render('welcome', { serverName, serverIcon });
});


app.get('/menu', auth, async (req, res) => {
    const { botClient } = req.app.locals;
    const mainGuild = botClient?.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    const serverName = mainGuild?.name || 'this server';
    const userId = req.user.id;

    let hasStaffAccess = false;
    try {
        if (SUPREME_IDS.includes(userId)) {
            hasStaffAccess = true;
        } else if (mainGuild) {
            const member = await mainGuild.members.fetch(userId).catch(() => null);
            if (member) {
                const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
                const setupPerms = await db.query("SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = 'setup'", [mainGuild.id]);
                const hasSetupRole = setupPerms.rows.some(row => member.roles.cache.has(row.role_id));
                const banPerms = await db.query("SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = 'ban'", [mainGuild.id]);
                const hasBanRole = banPerms.rows.some(row => member.roles.cache.has(row.role_id));
                hasStaffAccess = isAdmin || hasSetupRole || hasBanRole;
            }
        }
    } catch(e) { console.error('[MENU-ACCESS-CHECK]', e); }

    res.render('menu', { user: req.user, serverName, hasStaffAccess });
});


app.get('/appeal', (req, res) => {
    if (!req.isAuthenticated()) {
        req.session.returnTo = '/appeal';
        return req.session.save(() => res.redirect('/'));
    }
    const { botClient } = req.app.locals;
    const mainGuild = botClient?.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    const serverName = mainGuild?.name || 'this server';
    res.render('appeal_system', { user: req.user, serverName });
});

app.get('/appeal/submit', (req, res) => {
    const { botClient } = req.app.locals;
    const mainGuild = botClient?.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    const serverName = mainGuild?.name || 'this server';
    res.render('appeal_form', { user: req.user || null, serverName });
});

app.get('/appeal/status', (req, res) => {
    if (!req.isAuthenticated()) {
        req.session.returnTo = '/appeal/status';
        return req.session.save(() => res.redirect('/'));
    }
    const { botClient } = req.app.locals;
    const mainGuild = botClient?.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    const serverName = mainGuild?.name || 'this server';
    res.render('appeal_status', { user: req.user, serverName });
});

app.get('/api/appeal/status', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not logged in' });

    const userId = req.user.id;
    const guildId = process.env.DISCORD_GUILD_ID;

    try {
        const result = await db.query(
            "SELECT id, status, reason, timestamp, source FROM ban_appeals WHERE user_id = $1 AND guild_id = $2 ORDER BY timestamp DESC LIMIT 5",
            [userId, guildId]
        );
        return res.json({ appeals: result.rows });
    } catch (err) {
        console.error('[WEB-APPEAL-STATUS]', err);
        return res.status(500).json({ error: 'Failed to fetch status.' });
    }
});

app.post('/api/appeal/check', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ eligible: false, message: 'You must log in with Discord first.' });

    const { botClient } = req.app.locals;
    const userId = req.user.id;

    try {
        const mainGuild = await botClient.guilds.fetch(process.env.DISCORD_GUILD_ID).catch(() => null);
        if (!mainGuild) return res.json({ eligible: false, message: 'Server is currently unavailable. Try again later.' });

        const banEntry = await mainGuild.bans.fetch({ user: userId, force: true }).catch(() => null);
        if (!banEntry) return res.json({ eligible: false, message: 'You are not currently banned from this server.' });

        const blResult = await db.query("SELECT * FROM appeal_blacklist WHERE userid = $1 AND guildid = $2", [userId, mainGuild.id]);
        if (blResult.rows.length > 0) return res.json({ eligible: false, message: 'You are blacklisted from the appeal system. No further appeals will be accepted.' });

        const pendingResult = await db.query("SELECT message_id, id FROM ban_appeals WHERE user_id = $1 AND guild_id = $2 AND status = 'PENDING'", [userId, mainGuild.id]);
        if (pendingResult.rows.length > 0) {
            const appeal = pendingResult.rows[0];
            if (appeal.message_id) {
                const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [mainGuild.id]);
                if (chRes.rows[0]?.channel_id) {
                    const channel = mainGuild.channels.cache.get(chRes.rows[0].channel_id);
                    if (channel) {
                        try {
                            const msg = await channel.messages.fetch(appeal.message_id);
                            if (msg) return res.json({ eligible: false, message: 'You already have an active appeal pending review. Please wait for staff to respond.' });
                        } catch (e) {
                            await db.query("DELETE FROM ban_appeals WHERE id = $1", [appeal.id]);
                        }
                    }
                }
            } else {
                return res.json({ eligible: false, message: 'You already have an active appeal pending review.' });
            }
        }

        const banLog = await db.query("SELECT endsat FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'BAN' AND (status = 'ACTIVE' OR status = 'PERMANENT') ORDER BY timestamp DESC LIMIT 1", [userId, mainGuild.id]);
        if (banLog.rows[0]?.endsat) {
            const endsAt = new Date(Number(banLog.rows[0].endsat));
            return res.json({ eligible: false, message: `Your ban is temporary and not appealable. It expires on ${endsAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.` });
        }

        const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [mainGuild.id]);
        if (!chRes.rows[0]?.channel_id) return res.json({ eligible: false, message: 'The appeal system is currently offline. Please try again later.' });

        return res.json({ eligible: true });
    } catch (err) {
        console.error('[WEB-APPEAL-CHECK]', err);
        return res.status(500).json({ eligible: false, message: 'An error occurred while checking eligibility.' });
    }
});

app.post('/api/appeal/submit', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'You must log in with Discord first.' });

    const { botClient } = req.app.locals;
    const userId = req.user.id;
    const { q1, q2, q3 } = req.body;

    if (!q1 || q1.trim().length < 20) return res.status(400).json({ error: 'Answer 1 must be at least 20 characters.' });
    if (!q2 || q2.trim().length < 20) return res.status(400).json({ error: 'Answer 2 must be at least 20 characters.' });
    if (q1.length > 1000 || q2.length > 1000 || (q3 && q3.length > 1000)) return res.status(400).json({ error: 'Answers must be 1000 characters or less.' });

    try {
        const mainGuild = await botClient.guilds.fetch(process.env.DISCORD_GUILD_ID).catch(() => null);
        if (!mainGuild) return res.status(500).json({ error: 'Server unavailable.' });

        const banEntry = await mainGuild.bans.fetch({ user: userId, force: true }).catch(() => null);
        if (!banEntry) return res.status(400).json({ error: 'You are not currently banned.' });

        const blResult = await db.query("SELECT * FROM appeal_blacklist WHERE userid = $1 AND guildid = $2", [userId, mainGuild.id]);
        if (blResult.rows.length > 0) return res.status(403).json({ error: 'You are blacklisted from the appeal system.' });

        const pendingResult = await db.query("SELECT message_id, id FROM ban_appeals WHERE user_id = $1 AND guild_id = $2 AND status = 'PENDING'", [userId, mainGuild.id]);
        if (pendingResult.rows.length > 0) {
            const appeal = pendingResult.rows[0];
            if (appeal.message_id) {
                const chRes2 = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [mainGuild.id]);
                if (chRes2.rows[0]?.channel_id) {
                    const ch2 = mainGuild.channels.cache.get(chRes2.rows[0].channel_id);
                    if (ch2) {
                        try {
                            const msg = await ch2.messages.fetch(appeal.message_id);
                            if (msg) return res.status(400).json({ error: 'You already have an active appeal pending review.' });
                        } catch (e) {
                            await db.query("DELETE FROM ban_appeals WHERE id = $1", [appeal.id]);
                        }
                    }
                }
            } else {
                return res.status(400).json({ error: 'You already have an active appeal pending review.' });
            }
        }

        const banLog = await db.query("SELECT endsat FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'BAN' AND (status = 'ACTIVE' OR status = 'PERMANENT') ORDER BY timestamp DESC LIMIT 1", [userId, mainGuild.id]);
        if (banLog.rows[0]?.endsat) return res.status(400).json({ error: 'Temporary bans are not appealable.' });

        const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [mainGuild.id]);
        if (!chRes.rows[0]?.channel_id) return res.status(500).json({ error: 'Appeal system is currently offline.' });

        const channel = mainGuild.channels.cache.get(chRes.rows[0].channel_id);
        if (!channel) return res.status(500).json({ error: 'Appeal channel not found.' });

        const caseId = `APPEAL-${Date.now()}`;
        const safeQ3 = (q3 && q3.trim()) || 'N/A';
        const combinedReason = `**Why banned:** ${q1.trim()}\n**Why unban:** ${q2.trim()}\n**Extra:** ${safeQ3}`;

        const discordUser = await botClient.users.fetch(userId).catch(() => null);
        const username = discordUser?.tag || req.user.username || 'Unknown';
        const avatarURL = discordUser?.displayAvatarURL({ dynamic: true, size: 256 }) || `https://cdn.discordapp.com/avatars/${userId}/${req.user.avatar}.png`;

        const staffEmbed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('📝 New Ban Appeal Received')
            .setDescription('A new ban appeal has been submitted and is **pending review**.')
            .setThumbnail(avatarURL)
            .addFields(
                { name: '👤 User', value: `<@${userId}> (\`${userId}\`)`, inline: true },
                { name: '📅 Submitted', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                { name: '🌐 Source', value: '`Website`', inline: true },
                { name: '❓ 1. Why were you banned?', value: `>>> ${q1.trim()}` },
                { name: '⚖️ 2. Why should we unban you?', value: `>>> ${q2.trim()}` },
                { name: 'ℹ️ 3. Anything else?', value: `>>> ${safeQ3}` }
            )
            .setFooter({ text: `Appeal Case ID: ${caseId} • Submitted via Web` })
            .setTimestamp();

        const rows = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`appeal:accept:${caseId}:${userId}:${mainGuild.id}`).setLabel('Accept Appeal').setStyle(ButtonStyle.Success).setEmoji('✅'),
            new ButtonBuilder().setCustomId(`appeal:reject:${caseId}:${userId}:${mainGuild.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setEmoji('✖️'),
            new ButtonBuilder().setCustomId(`appeal:blacklist:${caseId}:${userId}:${mainGuild.id}`).setLabel('Block & Reject').setStyle(ButtonStyle.Secondary).setEmoji('⛔')
        );

        const msg = await channel.send({ embeds: [staffEmbed], components: [rows] });

        await db.query(
            `INSERT INTO ban_appeals (user_id, username, guild_id, reason, status, message_id, timestamp, source)
             VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, 'WEB')`,
            [userId, username, mainGuild.id, combinedReason, msg.id, Date.now()]
        );

        return res.json({ success: true });
    } catch (err) {
        console.error('[WEB-APPEAL-SUBMIT]', err);
        return res.status(500).json({ error: 'An error occurred while submitting your appeal.' });
    }
});

app.get('/guilds', auth, async (req, res) => {
    try {
        const { botClient } = req.app.locals;
        const userGuilds = req.user.guilds || [];
        const ALLOWED = [process.env.DISCORD_GUILD_ID, process.env.DISCORD_APPEAL_GUILD_ID].filter(id => id);
        const administrableGuilds = [];

        for (const uGuild of userGuilds) {
            if (!ALLOWED.includes(uGuild.id)) continue;
            if (botClient) {
                const guild = botClient.guilds.cache.get(uGuild.id);
                if (guild) {
                    let prefix = '!';
                    
                    // Intenta SELECT prefix; si no existe, usa fallback
                    try {
                        const dbSettings = await db.query('SELECT prefix FROM guild_settings WHERE guildid = $1', [guild.id]);
                        prefix = dbSettings.rows[0]?.prefix || '!';
                    } catch (e) {
                        console.log('[web.js] Error al obtener prefix:', e.message?.includes('prefix') ? 'columna no existe' : e.message);
                        prefix = '!';
                    }
                    
                    administrableGuilds.push({
                        id: guild.id,
                        name: guild.name,
                        icon: guild.iconURL({ extension: 'png', size: 128 }),
                        prefix: prefix,
                        memberCount: guild.memberCount,
                        type: (guild.id === process.env.DISCORD_APPEAL_GUILD_ID) ? 'Appeals' : 'Main'
                    });
                }
            }
        }
        res.render('guilds', { bot: botClient?.user, user: req.user, guilds: administrableGuilds });
    } catch (e) { console.error(e); res.status(500).send('Error'); }
});

app.get('/manage/:guildId', auth, protectRoute, async (req, res) => {
    try {
        const { botClient } = req.app.locals;
        const guildId = req.params.guildId;

        if (guildId === process.env.DISCORD_APPEAL_GUILD_ID) {
            const result = await db.query("SELECT * FROM ban_appeals WHERE status = 'PENDING' ORDER BY timestamp DESC");
            return res.render('appeals', { bot: botClient?.user, user: req.user, guildId, appeals: result.rows });
        }

        const modlogs = await db.query('SELECT COUNT(*) as count FROM modlogs WHERE guildid = $1', [guildId]);
        let activeTickets = 0;
        try {
            const t = await db.query("SELECT * FROM tickets WHERE status = 'OPEN' AND guild_id = $1", [guildId]);
            activeTickets = t.rows.filter(r => botClient.channels.cache.has(r.channel_id)).length;
        } catch (e) {}

        res.render('dashboard', {
            bot: botClient?.user, user: req.user, guildId,
            totalModlogs: modlogs.rows[0].count, activeTickets
        });
    } catch (e) { console.error(e); res.status(500).send('Server Error'); }
});

app.get('/modlogs/:guildId', auth, protectRoute, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        const { rows } = await db.query('SELECT * FROM modlogs WHERE guildid = $1 ORDER BY timestamp DESC LIMIT 50', [guildId]);
        res.render('modlogs', { bot: req.app.locals.botClient?.user, user: req.user, modlogs: rows, guildId });
    } catch (e) { res.status(500).send('Error'); }
});

app.get('/manage/:guildId/setup', auth, protectRoute, async (req, res) => {
    try {
        const { botClient } = req.app.locals;
        const guildId = req.params.guildId;
        const guild = botClient.guilds.cache.get(guildId);

        if (!guild) return res.redirect('/guilds');

        let settingsRes;
        try {
            settingsRes = await db.query('SELECT guildid, staff_roles, mod_immunity, universal_lock, prefix, delete_prefix_cmd_message, log_channel_id FROM guild_settings WHERE guildid = $1', [guildId]);
        } catch (e) {
            // Si falla por columna no existente, intenta sin delete_prefix_cmd_message
            if (e.message.includes('delete_prefix_cmd_message')) {
                settingsRes = await db.query('SELECT guildid, staff_roles, mod_immunity, universal_lock, prefix, log_channel_id FROM guild_settings WHERE guildid = $1', [guildId]);
            } else {
                throw e;
            }
        }
        const settings = {
            delete_prefix_cmd_message: false,
            ...(settingsRes.rows[0] || {})
        };

        const logsRes = await db.query('SELECT log_type, channel_id FROM log_channels WHERE guildid = $1', [guildId]);
        const logs = {};
        logsRes.rows.forEach(row => logs[row.log_type] = row.channel_id);

        const backupsRes = await db.query('SELECT antinuke_enabled, threshold_count, threshold_time, antinuke_ignore_supreme, antinuke_ignore_verified, antinuke_action FROM guild_backups WHERE guildid = $1', [guildId]);
        const antinuke = backupsRes.rows[0]?.antinuke_enabled || false;
        const antinukeSettings = backupsRes.rows[0] || { threshold_count: 10, threshold_time: 60, antinuke_ignore_supreme: true, antinuke_ignore_verified: true, antinuke_action: 'ban' };

        const lockdownRes = await db.query('SELECT channel_id FROM lockdown_channels WHERE guildid = $1', [guildId]);
        const lockdownChannels = lockdownRes.rows.map(r => r.channel_id);

        const automodRes = await db.query('SELECT * FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]);
        const automodRules = automodRes.rows.map(r => ({
            warnings: r.warnings_count,
            action: r.action_type,
            duration: r.action_duration
        }));
        
        const protectionsRes = await db.query('SELECT antimention_roles, antimention_bypass, antispam FROM automod_protections WHERE guildid = $1', [guildId]);
        const protections = protectionsRes.rows[0] || { antimention_roles: [], antimention_bypass: [], antispam: {} };
        const antiMention = {
            protected: protections.antimention_roles || [],
            bypass: protections.antimention_bypass || []
        };
        const antiSpam = protections.antispam || {};
        
        const cmdPermsRes = await db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1', [guildId]);
        const cmdSettingsRes = await db.query('SELECT command_name, enabled, ignored_channels FROM command_settings WHERE guildid = $1', [guildId]);
        
        const commandSettingsMap = {};
        cmdSettingsRes.rows.forEach(r => {
            let ignoredChannels = [];
            if (r.ignored_channels) {
                if (typeof r.ignored_channels === 'string') {
                    ignoredChannels = r.ignored_channels.split(',').filter(Boolean);
                } else if (Array.isArray(r.ignored_channels)) {
                    ignoredChannels = r.ignored_channels;
                }
            }
            commandSettingsMap[r.command_name] = {
                enabled: r.enabled !== false,
                ignoredChannels: ignoredChannels
            };
        });
        
        const commandOverrides = {};
        cmdPermsRes.rows.forEach(r => {
            if(r.command_name === 'setup') return;
            if(!commandOverrides[r.command_name]) commandOverrides[r.command_name] = { roles: [], ...commandSettingsMap[r.command_name] };
            commandOverrides[r.command_name].roles.push(r.role_id);
        });
        
        // Add command settings for commands without roles
        Object.keys(commandSettingsMap).forEach(cmd => {
            if (!commandOverrides[cmd]) {
                commandOverrides[cmd] = { roles: [], ...commandSettingsMap[cmd] };
            }
        });

        const customCmdsRes = await db.query('SELECT * FROM custom_commands WHERE guildid = $1', [guildId]);
        const customCommands = customCmdsRes.rows;

        const ticketPanelsRes = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1', [guildId]);
        const ticketPanels = ticketPanelsRes.rows;

        const botCommands = Array.from(botClient.commands.values())
            .filter(c => c.category !== 'developer' && c.data.name !== 'setup')
            .map(c => c.data.name)
            .sort();
        const guildRoles = guild.roles.cache.map(r => ({ id: r.id, name: r.name, color: r.hexColor })).sort((a,b) => b.position - a.position);
        
        const channels = guild.channels.cache.map(c => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId })).sort((a,b) => a.position - b.position);
        const textChannels = channels.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
        const categories = channels.filter(c => c.type === ChannelType.GuildCategory);

        res.render('setup', { 
            bot: botClient.user, user: req.user, guild, 
            settings, logs, antinuke, antinukeSettings, lockdownChannels,
            automodRules, antiMention, antiSpam, commandOverrides,
            customCommands, ticketPanels,
            botCommands, guildRoles, textChannels, categories, channels
        });
    } catch (e) { console.error(e); res.status(500).send("Error loading setup"); }
});

app.post('/api/setup/:guildId', auth, protectRoute, async (req, res) => {
    const guildId = req.params.guildId;
    const { 
        prefix, delete_prefix_cmd_message, staff_roles, 
        log_mod, log_cmd, log_appeal, log_nuke,
        antinuke_enabled, antinuke_threshold_count, antinuke_threshold_time, antinuke_action, antinuke_ignore_supreme, antinuke_ignore_verified,
        lockdown_channels,
        automod_rules, antimention_protected, antimention_bypass, antispam_config, command_overrides,
        custom_commands, ticket_panels
    } = req.body;

    try {
        if (!prefix || prefix.trim().length === 0) {
            return res.status(400).json({ error: 'Prefix cannot be empty.' });
        }
        if (prefix.length > 3) {
            return res.status(400).json({ error: 'Prefix must be 3 characters or less.' });
        }
        if (!/^[a-zA-Z0-9!@#$%^&*\-_+=.?~`]+$/.test(prefix)) {
            return res.status(400).json({ error: 'Prefix contains invalid characters. Use letters, numbers, or: !@#$%^&*-_+=.?~`' });
        }

        const threshCount = parseInt(antinuke_threshold_count);
        if (isNaN(threshCount) || threshCount < 1 || threshCount > 1000) {
            return res.status(400).json({ error: 'Antinuke threshold must be between 1 and 1000.' });
        }
        
        const threshTime = parseInt(antinuke_threshold_time);
        if (isNaN(threshTime) || threshTime < 10 || threshTime > 86400) {
            return res.status(400).json({ error: 'Antinuke window must be between 10 and 86400 seconds.' });
        }

        const normalizeAction = (action) => {
            const map = { 'timeout': 'MUTE', 'mute': 'MUTE', 'ban': 'BAN', 'kick': 'KICK' };
            return map[String(action).toLowerCase()] || action;
        };

        if (automod_rules && Array.isArray(automod_rules)) {
            const seenWarnings = new Set();

            for (const rule of automod_rules) {
                rule.action = normalizeAction(rule.action);
            }

            for (const rule of automod_rules) {
                if (rule.warnings < 1 || rule.warnings > 10) {
                    return res.status(400).json({ error: 'Automod warnings must be between 1 and 10.' });
                }
                if (seenWarnings.has(rule.warnings)) {
                    return res.status(400).json({ error: 'Duplicate warning counts in automod rules.' });
                }
                seenWarnings.add(rule.warnings);

                const allowed = ['BAN', 'MUTE', 'KICK'];
                if (!allowed.includes(rule.action)) {
                    return res.status(400).json({ error: `Invalid automod action: '${rule.action}'. Must be one of: BAN, MUTE, KICK` });
                }
            }
        }

        if (custom_commands && Array.isArray(custom_commands)) {
            const seenNames = new Set();
            for (const cc of custom_commands) {
                if (!cc.name || cc.name.trim().length === 0) {
                    return res.status(400).json({ error: 'Custom command name cannot be empty.' });
                }
                if (cc.name.length > 50) {
                    return res.status(400).json({ error: 'Custom command name must be 50 characters or less.' });
                }
                if (!/^[a-z0-9_-]+$/.test(cc.name.toLowerCase())) {
                    return res.status(400).json({ error: `Command name "${cc.name}" contains invalid characters.` });
                }
                if (seenNames.has(cc.name.toLowerCase())) {
                    return res.status(400).json({ error: `Duplicate command name: "${cc.name}"` });
                }
                seenNames.add(cc.name.toLowerCase());
            }
        }

        if (ticket_panels && Array.isArray(ticket_panels)) {
            const seenIds = new Set();
            for (const tp of ticket_panels) {
                if (!tp.id || tp.id.trim().length === 0) {
                    return res.status(400).json({ error: 'Panel ID cannot be empty.' });
                }
                if (tp.id.length > 50) {
                    return res.status(400).json({ error: 'Panel ID must be 50 characters or less.' });
                }
                if (!/^[a-z0-9-_]+$/.test(tp.id.toLowerCase())) {
                    return res.status(400).json({ error: `Panel ID "${tp.id}" contains invalid characters.` });
                }
                if (seenIds.has(tp.id.toLowerCase())) {
                    return res.status(400).json({ error: `Duplicate panel ID: "${tp.id}"` });
                }
                seenIds.add(tp.id.toLowerCase());
                
                if (!tp.title || tp.title.trim().length === 0) {
                    return res.status(400).json({ error: `Panel "${tp.id}" title cannot be empty.` });
                }
                if (tp.title.length > 100) {
                    return res.status(400).json({ error: `Panel "${tp.id}" title must be 100 characters or less.` });
                }
                
                if (tp.description && tp.description.length > 2000) {
                    return res.status(400).json({ error: `Panel "${tp.id}" description must be 2000 characters or less.` });
                }
                
                if (!tp.btnLabel || tp.btnLabel.trim().length === 0) {
                    return res.status(400).json({ error: `Panel "${tp.id}" button label cannot be empty.` });
                }
                if (tp.btnLabel.length > 80) {
                    return res.status(400).json({ error: `Panel "${tp.id}" button label must be 80 characters or less.` });
                }
                
                if (tp.btnEmoji && !isValidEmoji(tp.btnEmoji)) {
                    return res.status(400).json({ error: `Invalid emoji in panel '${tp.title}': ${tp.btnEmoji}` });
                }
                
                if (tp.ticketLimit && (isNaN(tp.ticketLimit) || tp.ticketLimit < 1 || tp.ticketLimit > 100)) {
                    return res.status(400).json({ error: `Panel "${tp.id}" ticket limit must be between 1 and 100.` });
                }
                
                if (tp.panelColor && !isValidHexColor(tp.panelColor)) {
                    return res.status(400).json({ error: `Panel "${tp.id}" has invalid color: ${tp.panelColor}` });
                }
                
                if (tp.welcomeColor && !isValidHexColor(tp.welcomeColor)) {
                    return res.status(400).json({ error: `Panel "${tp.id}" welcome color is invalid: ${tp.welcomeColor}` });
                }
                
                if (tp.welcomeMsg && tp.welcomeMsg.length > 2000) {
                    return res.status(400).json({ error: `Panel "${tp.id}" welcome message must be 2000 characters or less.` });
                }
            }
        }

        if (ticket_panels && Array.isArray(ticket_panels)) {
            for (const tp of ticket_panels) {
                if (tp.btnEmoji && !isValidEmoji(tp.btnEmoji)) {
                    return res.status(400).json({ error: `Invalid emoji in panel '${tp.title}': ${tp.btnEmoji}` });
                }
            }
        }

        // Actualizar configuración del guild
        try {
            await db.query(`INSERT INTO guild_settings (guildid, prefix, delete_prefix_cmd_message, staff_roles) VALUES ($1, $2, $3, $4) ON CONFLICT (guildid) DO UPDATE SET prefix = $2, delete_prefix_cmd_message = $3, staff_roles = $4`, [guildId, prefix || '!', delete_prefix_cmd_message === 'on', staff_roles || null]);
        } catch (e) {
            // Si la columna delete_prefix_cmd_message no existe, intentar sin ella
            if (e.message.includes('delete_prefix_cmd_message')) {
                console.log('⚠️ delete_prefix_cmd_message no existe aún, insertando sin ella...');
                await db.query(`INSERT INTO guild_settings (guildid, prefix, staff_roles) VALUES ($1, $2, $3) ON CONFLICT (guildid) DO UPDATE SET prefix = $2, staff_roles = $3`, [guildId, prefix || '!', staff_roles || null]);
            } else {
                throw e;
            }
        }

        const updateLog = async (type, chId) => {
            if (chId) await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT (guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, type, chId]);
            else await db.query("DELETE FROM log_channels WHERE guildid = $1 AND log_type = $2", [guildId, type]);
        };
        await updateLog('modlog', log_mod);
        await updateLog('cmdlog', log_cmd);
        await updateLog('banappeal', log_appeal);
        await updateLog('antinuke', log_nuke);

        await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled, threshold_count, threshold_time, antinuke_ignore_supreme, antinuke_ignore_verified, antinuke_action) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2, threshold_count = $3, threshold_time = $4, antinuke_ignore_supreme = $5, antinuke_ignore_verified = $6, antinuke_action = $7`, [guildId, antinuke_enabled === 'on', antinuke_threshold_count || 10, antinuke_threshold_time || 60, antinuke_ignore_supreme === 'on', antinuke_ignore_verified === 'on', antinuke_action || 'ban']);
        
        await db.query("DELETE FROM lockdown_channels WHERE guildid = $1", [guildId]);
        if (lockdown_channels && Array.isArray(lockdown_channels)) {
            for (const c of lockdown_channels) await db.query("INSERT INTO lockdown_channels (guildid, channel_id) VALUES ($1, $2)", [guildId, c]);
        }

        await db.query("DELETE FROM automod_rules WHERE guildid = $1", [guildId]);
        if (automod_rules && Array.isArray(automod_rules)) {
            for (const [idx, rule] of automod_rules.entries()) {
                await db.query(`INSERT INTO automod_rules (guildid, rule_order, warnings_count, action_type, action_duration) VALUES ($1, $2, $3, $4, $5)`, 
                    [guildId, idx + 1, rule.warnings, rule.action, rule.duration || null]);
            }
        }
        const antiMentionProtected = Array.isArray(antimention_protected) ? antimention_protected : [];
        const antiMentionBypass = Array.isArray(antimention_bypass) ? antimention_bypass : [];
        const antiSpamConfig = typeof antispam_config === 'object' ? antispam_config : {};
        
        await db.query(
            `INSERT INTO automod_protections (guildid, antimention_roles, antimention_bypass, antispam)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (guildid) DO UPDATE SET antimention_roles = $2, antimention_bypass = $3, antispam = $4`,
            [guildId, antiMentionProtected.length ? antiMentionProtected : null, antiMentionBypass.length ? antiMentionBypass : null, antiSpamConfig]
        );
        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name != 'setup'", [guildId]);
        await db.query("DELETE FROM command_settings WHERE guildid = $1", [guildId]);
        
        if (command_overrides && Array.isArray(command_overrides)) {
            for (const ov of command_overrides) {
                for (const rId of ov.roles) {
                    await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)", [guildId, ov.command, rId]);
                }
                // Save command settings (enabled, ignored_channels)
                const enabled = ov.enabled !== false;
                const ignoredChannels = ov.ignoredChannels && Array.isArray(ov.ignoredChannels) ? ov.ignoredChannels.join(',') : '';
                await db.query(
                    "INSERT INTO command_settings (guildid, command_name, enabled, ignored_channels) VALUES ($1, $2, $3, $4) ON CONFLICT (guildid, command_name) DO UPDATE SET enabled = $3, ignored_channels = $4",
                    [guildId, ov.command, enabled, ignoredChannels]
                );
            }
        }

        await db.query("DELETE FROM custom_commands WHERE guildid = $1", [guildId]);
        if (custom_commands && Array.isArray(custom_commands)) {
            for (const cc of custom_commands) {
                await db.query(`INSERT INTO custom_commands (guildid, name, response_json, allowed_roles) VALUES ($1, $2, $3, $4)`, 
                    [guildId, cc.name, cc.response, cc.roles.join(',')]);
            }
        }

        await db.query("DELETE FROM ticket_panels WHERE guild_id = $1", [guildId]);
        if (ticket_panels && Array.isArray(ticket_panels)) {
            for (const tp of ticket_panels) {
                await db.query(`
                    INSERT INTO ticket_panels (guild_id, panel_id, title, description, button_label, button_style, button_emoji, support_role_id, blacklist_role_id, ticket_category_id, log_channel_id, welcome_message, panel_color, welcome_color, ticket_limit)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                `, [guildId, tp.id, tp.title, tp.description, tp.btnLabel, tp.btnStyle, tp.btnEmoji, tp.supportRole, tp.blacklistRole, tp.category, tp.logChannel, tp.welcomeMsg, tp.panelColor, tp.welcomeColor, tp.ticketLimit]);
            }
        }

        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/api/tickets/post-panel', auth, protectRoute, async (req, res) => {
    const { guildId, panelId, channelId } = req.body;
    const { botClient } = req.app.locals;
    
    try {
        const guild = botClient.guilds.cache.get(guildId);
        const channel = guild.channels.cache.get(channelId);
        if (!channel) throw new Error("Channel not found");

        const resDB = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guildId, panelId]);
        if (resDB.rows.length === 0) throw new Error("Panel not saved. Save changes first.");
        const p = resDB.rows[0];

        const embed = new EmbedBuilder()
            .setTitle(p.title)
            .setDescription(p.description)
            .setColor(p.panel_color || '#5865F2')
            .setFooter({ text: 'Made by Ukirama' });

        const btn = new ButtonBuilder()
            .setCustomId(`ticket_open_${p.panel_id}`)
            .setLabel(p.button_label)
            .setStyle(ButtonStyle[p.button_style] || ButtonStyle.Primary);

        try { if(p.button_emoji) btn.setEmoji(p.button_emoji); } 
        catch (e) { throw new Error(`Invalid Emoji: ${p.button_emoji}`); }

        await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tickets/post-multipanel', auth, protectRoute, async (req, res) => {
    const { guildId, panels, channelId } = req.body;
    const { botClient } = req.app.locals;

    try {
        const guild = botClient.guilds.cache.get(guildId);
        const channel = guild.channels.cache.get(channelId);
        if (!channel) throw new Error("Channel not found");

        const resDB = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = ANY($2)', [guildId, panels]);
        const orderedPanels = panels.map(id => resDB.rows.find(r => r.panel_id === id)).filter(Boolean);

        if (orderedPanels.length === 0) throw new Error("No valid panels found.");

        const embeds = orderedPanels.map(p => new EmbedBuilder()
            .setTitle(p.title)
            .setDescription(p.description)
            .setColor(p.panel_color || '#5865F2')
        );
        embeds[embeds.length - 1].setFooter({ text: 'Made by Ukirama' });

        const buttons = [];
        for (const p of orderedPanels) {
            const btn = new ButtonBuilder()
                .setCustomId(`ticket_open_${p.panel_id}`)
                .setLabel(p.button_label)
                .setStyle(ButtonStyle[p.button_style] || ButtonStyle.Primary);
            
            try { if(p.button_emoji) btn.setEmoji(p.button_emoji); }
            catch (e) { throw new Error(`Invalid Emoji in panel '${p.title}': ${p.button_emoji}`); }
            
            buttons.push(btn);
        }

        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }

        await channel.send({ embeds, components: rows });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/appeals/:action', auth, async (req, res, next) => {
    req.body.guildId = process.env.DISCORD_APPEAL_GUILD_ID;
    next();
}, protectRoute, async (req, res) => {
    const { action } = req.params;
    const { appealId, reason } = req.body;
    const { botClient } = req.app.locals;

    try {
        const appealRes = await db.query('SELECT * FROM ban_appeals WHERE id = $1', [appealId]);
        if (!appealRes.rows[0]) return res.status(404).json({ error: 'Appeal not found' });
        const appeal = appealRes.rows[0];
        
        if (appeal.status !== 'PENDING') {
            return res.status(400).json({ error: `Appeal is already ${appeal.status}. Cannot process.` });
        }

        const mainGuild = await botClient.guilds.fetch(process.env.DISCORD_GUILD_ID).catch(() => null);
        const targetUser = await botClient.users.fetch(appeal.user_id).catch(() => null);
        const moderator = req.user;

        if (!mainGuild) return res.status(500).json({ error: 'Server unavailable' });

        let dbStatus = 'PENDING', embedColor = 0xF1C40F, embedTitle = 'Updated', embedDesc = '';

        const WEB_STATUS_URL = (process.env.CALLBACK_URL || '').replace(/\/auth\/discord\/callback$/, '/appeal/status');

        if (action === 'approve') {
            dbStatus = 'APPROVED'; embedColor = 0x2ECC71; embedTitle = '✅ Appeal Accepted'; embedDesc = `Approved by <@${moderator.id}>`;
            await mainGuild.members.unban(appeal.user_id, `Web Unban by ${moderator.username}`).catch(() => {});
            if (targetUser) {
                const dm = new EmbedBuilder().setColor(0x2ECC71).setTitle('✅ Appeal Approved').setDescription(`Your appeal for **${mainGuild.name}** was accepted.`).addFields({ name: 'Message', value: reason || 'Welcome back!' });
                if (process.env.DISCORD_MAIN_INVITE) dm.addFields({ name: '🔗 Rejoin Server', value: `[**Click here**](${process.env.DISCORD_MAIN_INVITE})` });
                if (WEB_STATUS_URL) dm.addFields({ name: '🌐 View on Website', value: `[**Check Appeal Status**](${WEB_STATUS_URL})` });
                await targetUser.send({ embeds: [dm] }).catch(() => {});
            }
            await db.query(`UPDATE modlogs SET status = 'EXPIRED', endsat = NULL WHERE guildid = $1 AND userid = $2 AND action = 'BAN'`, [mainGuild.id, appeal.user_id]);
            await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, status, appealable) VALUES ($1, $2, 'UNBAN', $3, $4, $5, $6, $7, $8, 'EXECUTED', false)`, [`UNBAN-${Date.now()}`, mainGuild.id, appeal.user_id, appeal.username, moderator.id, moderator.username, reason || 'Web Accept', Date.now()]);
        
        } else if (action === 'reject') {
            dbStatus = 'REJECTED'; embedColor = 0xE74C3C; embedTitle = '❌ Appeal Rejected'; embedDesc = `Rejected by <@${moderator.id}>`;
            if (targetUser) {
                const dm = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Appeal Rejected').setDescription(`Your appeal for **${mainGuild.name}** was rejected.`).addFields({ name: 'Reason', value: reason || 'No details provided.' });
                if (WEB_STATUS_URL) dm.addFields({ name: '🌐 View on Website', value: `[**Check Appeal Status**](${WEB_STATUS_URL})` });
                await targetUser.send({ embeds: [dm] }).catch(() => {});
            }

        } else if (action === 'blacklist') {
            dbStatus = 'BLACKLISTED'; embedColor = 0x000000; embedTitle = '⛔ Appeal Blacklisted'; embedDesc = `Blacklisted by <@${moderator.id}>`;
            await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [appeal.user_id, mainGuild.id]);
            if (targetUser) {
                const dm = new EmbedBuilder().setColor(0x000000).setTitle('⛔ Appeal Blocked').setDescription(`Your appeal was rejected and you are blocked from future appeals.`);
                if (WEB_STATUS_URL) dm.addFields({ name: '🌐 View on Website', value: `[**Check Appeal Status**](${WEB_STATUS_URL})` });
                await targetUser.send({ embeds: [dm] }).catch(() => {});
            }
        }

        await db.query("UPDATE ban_appeals SET status = $1 WHERE id = $2", [dbStatus, appealId]);
        
        if (dbStatus === 'BLACKLISTED') {
            await db.query("DELETE FROM ban_appeals WHERE user_id = $1 AND guild_id = $2 AND status = 'PENDING' AND id != $3", [appeal.user_id, mainGuild.id, appealId]);
        } else if (dbStatus === 'APPROVED' || dbStatus === 'REJECTED') {
            await db.query("DELETE FROM ban_appeals WHERE user_id = $1 AND guild_id = $2 AND status = 'PENDING' AND id != $3", [appeal.user_id, mainGuild.id, appealId]);
        }

        if (appeal.message_id) {
            const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [process.env.DISCORD_GUILD_ID]);
            if (chRes.rows[0]?.channel_id) {
                const ch = await botClient.channels.fetch(chRes.rows[0].channel_id).catch(() => null);
                if (ch) {
                    const msg = await ch.messages.fetch(appeal.message_id).catch(() => null);
                    if (msg && msg.editable) {
                        const newEmbed = EmbedBuilder.from(msg.embeds[0]).setColor(embedColor).setTitle(embedTitle).setDescription(embedDesc).setFooter({ text: `${dbStatus} by ${moderator.username}` }).setTimestamp();
                        await msg.edit({ embeds: [newEmbed], components: [] });
                    }
                }
            }
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reset/:guildId', auth, protectRoute, async (req, res) => {
    const guildId = req.params.guildId;
    try {
        await db.query("DELETE FROM automod_rules WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM modlogs WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM command_permissions WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM log_channels WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM guild_settings WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM appeal_blacklist WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM pending_appeals WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM guild_backups WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM ticket_panels WHERE guild_id = $1", [guildId]);
        await db.query("DELETE FROM tickets WHERE guild_id = $1", [guildId]);
        await db.query("DELETE FROM lockdown_channels WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM lockdown_backups WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM afk_users WHERE guildid = $1", [guildId]);
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/transcript/:id', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM transcripts WHERE ticket_id = $1', [req.params.id]);
        if (!result.rows[0]) return res.status(404).send('Not Found');
        const data = result.rows[0];
        if (data.messages && data.messages.html) return res.send(data.messages.html);
        return res.send('Format outdated');
    } catch (error) { res.status(500).send('Error'); }
});

module.exports = app;
