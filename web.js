const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const { join } = require('path');
const { EmbedBuilder, PermissionsBitField, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const db = require('./utils/db');
const { SUPREME_IDS } = require('./utils/config');

const app = express();
const SCOPES = ['identify', 'guilds'];

function isValidEmoji(emoji) {
    if (!emoji) return false;
    const unicodeRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/;
    const customRegex = /<?(a)?:?(\w{2,32}):(\d{17,19})>?/;
    const idRegex = /^\d{17,19}$/;
    return unicodeRegex.test(emoji) || customRegex.test(emoji) || idRegex.test(emoji);
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new Strategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: SCOPES
}, (_, __, profile, done) => process.nextTick(() => done(null, profile))));

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(express.static(join(__dirname, 'public')));
app.use(express.json());
app.use(session({

    name: `session_${process.env.CLIENT_ID.slice(-5)}`, 
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true, 
        httpOnly: true
    }
}));
app.use(passport.initialize());
app.use(passport.session());

const auth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/discord');

const protectRoute = async (req, res, next) => {
    const { botClient } = req.app.locals;
    const userId = req.user.id;
    const targetGuildId = req.params.guildId || req.body.guildId;

    if (!targetGuildId) return next();
    if (SUPREME_IDS.includes(userId)) return next();

    try {
        const settingsRes = await db.query('SELECT universal_lock FROM guild_settings WHERE guildid = $1', [targetGuildId]);
        if (settingsRes.rows[0]?.universal_lock) {
            if (req.xhr || req.headers.accept.indexOf('json') > -1) return res.status(403).json({ error: '⛔ Universal Lockdown Active.' });
            return res.render('error', { message: '⛔ <b>Lockdown Active</b><br>Access restricted by Administration.' });
        }

        const mainGuildId = process.env.DISCORD_GUILD_ID;
        const mainGuild = botClient.guilds.cache.get(mainGuildId);
        if (!mainGuild) return res.status(404).send('Main Server not accessible.');

        const memberInMain = await mainGuild.members.fetch(userId).catch(() => null);
        if (!memberInMain) return res.render('error', { message: '⛔ <b>Access Denied</b><br>You must be a member of the <b>Main Server</b>.' });

        const isAdmin = memberInMain.permissions.has(PermissionsBitField.Flags.Administrator);
        const setupPerms = await db.query("SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = 'setup'", [mainGuildId]);
        const hasSetupRole = setupPerms.rows.some(row => memberInMain.roles.cache.has(row.role_id));
        
        const staffRes = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [mainGuildId]);
        let hasStaffRole = false;
        if (staffRes.rows[0]?.staff_roles) {
            hasStaffRole = staffRes.rows[0].staff_roles.split(',').some(rId => memberInMain.roles.cache.has(rId));
        }

        if (targetGuildId === process.env.DISCORD_GUILD_ID) {
            if (isAdmin || hasSetupRole) return next();
            return res.render('error', { message: '⛔ <b>Access Denied</b><br>Requires <b>Administrator</b> or <b>Setup Role</b>.' });
        }
        if (targetGuildId === process.env.DISCORD_APPEAL_GUILD_ID) {
            if (isAdmin || hasSetupRole || hasStaffRole) return next();
            return res.render('error', { message: '⛔ <b>Access Denied</b><br>Requires <b>Staff</b>, <b>Admin</b>, or <b>Setup Role</b>.' });
        }
        return res.status(403).send('Invalid Guild Context');

    } catch (err) {
        console.error("Security Error:", err);
        return res.status(500).send("Internal Security Error");
    }
};

app.get('/auth/discord', passport.authenticate('discord', { scope: SCOPES }));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => req.logout(() => res.redirect('/')));
app.get('/', auth, (req, res) => res.redirect('/guilds'));

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
                    const dbSettings = await db.query('SELECT prefix FROM guild_settings WHERE guildid = $1', [guild.id]);
                    administrableGuilds.push({
                        id: guild.id,
                        name: guild.name,
                        icon: guild.iconURL({ extension: 'png', size: 128 }),
                        prefix: dbSettings.rows[0]?.prefix || '!',
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

        const settingsRes = await db.query('SELECT * FROM guild_settings WHERE guildid = $1', [guildId]);
        const settings = settingsRes.rows[0] || {};

        const logsRes = await db.query('SELECT log_type, channel_id FROM log_channels WHERE guildid = $1', [guildId]);
        const logs = {};
        logsRes.rows.forEach(row => logs[row.log_type] = row.channel_id);

        const backupsRes = await db.query('SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1', [guildId]);
        const antinuke = backupsRes.rows[0]?.antinuke_enabled || false;

        const lockdownRes = await db.query('SELECT channel_id FROM lockdown_channels WHERE guildid = $1', [guildId]);
        const lockdownChannels = lockdownRes.rows.map(r => r.channel_id);

        const automodRes = await db.query('SELECT * FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]);
        const automodRules = automodRes.rows.map(r => ({
            warnings: r.warnings_count,
            action: r.action_type,
            duration: r.action_duration
        }));
        
        const cmdPermsRes = await db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1', [guildId]);
        const commandOverrides = {};
        cmdPermsRes.rows.forEach(r => {
            if(r.command_name === 'setup') return;
            if(!commandOverrides[r.command_name]) commandOverrides[r.command_name] = [];
            commandOverrides[r.command_name].push(r.role_id);
        });

        const customCmdsRes = await db.query('SELECT * FROM custom_commands WHERE guildid = $1', [guildId]);
        const customCommands = customCmdsRes.rows;

        const ticketPanelsRes = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1', [guildId]);
        const ticketPanels = ticketPanelsRes.rows;

        const botCommands = botClient.commands.map(c => c.data.name).filter(n => n !== 'setup').sort();
        const guildRoles = guild.roles.cache.map(r => ({ id: r.id, name: r.name, color: r.hexColor })).sort((a,b) => b.position - a.position);
        
        const channels = guild.channels.cache.map(c => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId })).sort((a,b) => a.position - b.position);
        const textChannels = channels.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
        const categories = channels.filter(c => c.type === ChannelType.GuildCategory);

        res.render('setup', { 
            bot: botClient.user, user: req.user, guild, 
            settings, logs, antinuke, lockdownChannels,
            automodRules, commandOverrides,
            customCommands, ticketPanels,
            botCommands, guildRoles, textChannels, categories
        });
    } catch (e) { console.error(e); res.status(500).send("Error loading setup"); }
});

app.post('/api/setup/:guildId', auth, protectRoute, async (req, res) => {
    const guildId = req.params.guildId;
    const { 
        prefix, staff_roles, 
        log_mod, log_cmd, log_appeal, log_nuke,
        antinuke_enabled, lockdown_channels,
        automod_rules, command_overrides,
        custom_commands, ticket_panels
    } = req.body;

    try {
        if (ticket_panels && Array.isArray(ticket_panels)) {
            for (const tp of ticket_panels) {
                if (tp.btnEmoji && !isValidEmoji(tp.btnEmoji)) {
                    return res.status(400).json({ error: `Invalid emoji in panel '${tp.title}': ${tp.btnEmoji}` });
                }
            }
        }

        await db.query(`INSERT INTO guild_settings (guildid, prefix, staff_roles) VALUES ($1, $2, $3) ON CONFLICT (guildid) DO UPDATE SET prefix = $2, staff_roles = $3`, [guildId, prefix || '!', staff_roles || null]);

        const updateLog = async (type, chId) => {
            if (chId) await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT (guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, type, chId]);
            else await db.query("DELETE FROM log_channels WHERE guildid = $1 AND log_type = $2", [guildId, type]);
        };
        await updateLog('modlog', log_mod);
        await updateLog('cmdlog', log_cmd);
        await updateLog('banappeal', log_appeal);
        await updateLog('antinuke', log_nuke);

        await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2`, [guildId, antinuke_enabled === 'on']);
        
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

        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name != 'setup'", [guildId]);
        if (command_overrides && Array.isArray(command_overrides)) {
            for (const ov of command_overrides) {
                for (const rId of ov.roles) {
                    await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)", [guildId, ov.command, rId]);
                }
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
            .setFooter({ text: 'Made by: ukirama' });

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
        embeds[embeds.length - 1].setFooter({ text: 'Made by: ukirama' });

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

        const mainGuild = await botClient.guilds.fetch(process.env.DISCORD_GUILD_ID).catch(() => null);
        const targetUser = await botClient.users.fetch(appeal.user_id).catch(() => null);
        const moderator = req.user;

        if (!mainGuild) return res.status(500).json({ error: 'Main guild unavailable' });

        let dbStatus = 'PENDING', embedColor = 0xF1C40F, embedTitle = 'Updated', embedDesc = '';

        if (action === 'approve') {
            dbStatus = 'APPROVED'; embedColor = 0x2ECC71; embedTitle = '✅ Appeal Accepted'; embedDesc = `Approved by <@${moderator.id}>`;
            await mainGuild.members.unban(appeal.user_id, `Web Unban by ${moderator.username}`).catch(() => {});
            if (targetUser) {
                const dm = new EmbedBuilder().setColor(0x2ECC71).setTitle('✅ Appeal Approved').setDescription(`Your appeal for **${mainGuild.name}** was accepted.`).addFields({ name: 'Message', value: reason || 'Welcome back!' });
                if (process.env.DISCORD_MAIN_INVITE) dm.addFields({ name: 'Link', value: process.env.DISCORD_MAIN_INVITE });
                await targetUser.send({ embeds: [dm] }).catch(() => {});
            }
            await db.query(`UPDATE modlogs SET status = 'EXPIRED', endsAt = NULL WHERE guildid = $1 AND userid = $2 AND action = 'BAN'`, [mainGuild.id, appeal.user_id]);
            await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, status, appealable) VALUES ($1, $2, 'UNBAN', $3, $4, $5, $6, $7, $8, 'EXECUTED', false)`, [`UNBAN-${Date.now()}`, mainGuild.id, appeal.user_id, appeal.username, moderator.id, moderator.username, reason || 'Web Accept', Date.now()]);
        
        } else if (action === 'reject') {
            dbStatus = 'REJECTED'; embedColor = 0xE74C3C; embedTitle = '❌ Appeal Rejected'; embedDesc = `Rejected by <@${moderator.id}>`;
            if (targetUser) {
                const dm = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Appeal Rejected').setDescription(`Your appeal for **${mainGuild.name}** was rejected.`).addFields({ name: 'Reason', value: reason || 'No details provided.' });
                await targetUser.send({ embeds: [dm] }).catch(() => {});
            }

        } else if (action === 'blacklist') {
            dbStatus = 'BLACKLISTED'; embedColor = 0x000000; embedTitle = '⛔ Appeal Blacklisted'; embedDesc = `Blacklisted by <@${moderator.id}>`;
            await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [appeal.user_id, mainGuild.id]);
            if (targetUser) {
                const dm = new EmbedBuilder().setColor(0x000000).setTitle('⛔ Appeal Blocked').setDescription(`Your appeal was rejected and you are blocked from future appeals.`);
                await targetUser.send({ embeds: [dm] }).catch(() => {});
            }
        }

        await db.query("UPDATE ban_appeals SET status = $1 WHERE id = $2", [dbStatus, appealId]);

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