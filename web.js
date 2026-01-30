const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const { join } = require('path');
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('./utils/db');


const app = express();
const SCOPES = ['identify', 'guilds'];

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
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));
app.use(passport.initialize());
app.use(passport.session());

const auth = (req, res, next) => req.isAuthenticated() ? next() : res.redirect('/auth/discord');


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
            const isAdmin = (uGuild.permissions & 0x8) === 0x8;
            
            if (isAdmin && botClient) {
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

app.get('/manage/:guildId', auth, async (req, res) => {
    try {
        const { botClient } = req.app.locals;
        const guildId = req.params.guildId;

        if (guildId !== process.env.DISCORD_GUILD_ID && guildId !== process.env.DISCORD_APPEAL_GUILD_ID) return res.redirect('/guilds');

        if (guildId === process.env.DISCORD_APPEAL_GUILD_ID) {
            const result = await db.query("SELECT * FROM ban_appeals WHERE status = 'PENDING' ORDER BY timestamp DESC");
            return res.render('appeals', {
                bot: botClient?.user, user: req.user, guildId,
                appeals: result.rows
            });
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

app.get('/modlogs/:guildId', auth, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        if (guildId !== process.env.DISCORD_GUILD_ID) return res.redirect('/guilds');
        const { rows } = await db.query('SELECT * FROM modlogs WHERE guildid = $1 ORDER BY timestamp DESC LIMIT 50', [guildId]);
        res.render('modlogs', { bot: req.app.locals.botClient?.user, user: req.user, modlogs: rows, guildId });
    } catch (e) { res.status(500).send('Error'); }
});

app.post('/api/appeals/:action', auth, async (req, res) => {
    const { action } = req.params; 
    const { appealId, reason } = req.body;
    const { botClient } = req.app.locals;

    try {
        const appealRes = await db.query('SELECT * FROM ban_appeals WHERE id = $1', [appealId]);
        if (!appealRes.rows[0]) return res.status(404).json({ error: 'Appeal not found' });
        const appeal = appealRes.rows[0];

        const mainGuildId = process.env.DISCORD_GUILD_ID;
        const mainGuild = await botClient.guilds.fetch(mainGuildId).catch(() => null);
        const targetUser = await botClient.users.fetch(appeal.user_id).catch(() => null);
        const moderator = req.user;

        if (!mainGuild) return res.status(500).json({ error: 'Main guild not accessible' });

        let dbStatus = 'PENDING';
        let embedColor = 0xF1C40F;
        let embedTitle = 'Appeal Updated';
        let embedDesc = '';

        if (action === 'approve') {
            dbStatus = 'APPROVED';
            embedColor = 0x2ECC71;
            embedTitle = '✅ Appeal Accepted';
            embedDesc = `This appeal has been **APPROVED** by <@${moderator.id}>.`;

            await mainGuild.members.unban(appeal.user_id, `Web Appeal Accepted by ${moderator.username}`).catch(() => {});
            
            if (targetUser) {
                const dm = new EmbedBuilder().setColor(0x2ECC71).setTitle('✅ Appeal Approved').setDescription(`Your appeal for **${mainGuild.name}** was accepted.`).addFields({ name: 'Message', value: reason || 'Welcome back!' });
                if (process.env.DISCORD_MAIN_INVITE) dm.addFields({ name: 'Link', value: process.env.DISCORD_MAIN_INVITE });
                await targetUser.send({ embeds: [dm] }).catch(() => {});
            }

            await db.query(`UPDATE modlogs SET status = 'EXPIRED', endsAt = NULL WHERE guildid = $1 AND userid = $2 AND status = 'ACTIVE' AND action = 'BAN'`, [mainGuild.id, appeal.user_id]);
            const unbanId = `UNBAN-${Date.now()}`;
            await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, status, appealable) VALUES ($1, $2, 'UNBAN', $3, $4, $5, $6, $7, $8, 'EXECUTED', false)`, [unbanId, mainGuild.id, appeal.user_id, appeal.username, moderator.id, moderator.username, reason || 'Web Accept', Date.now()]);

        } else if (action === 'reject') {
            dbStatus = 'REJECTED';
            embedColor = 0xE74C3C;
            embedTitle = '❌ Appeal Rejected';
            embedDesc = `This appeal has been **REJECTED** by <@${moderator.id}>.`;

            if (targetUser) {
                const dm = new EmbedBuilder().setColor(0xE74C3C).setTitle('❌ Appeal Rejected').setDescription(`Your appeal for **${mainGuild.name}** was rejected.`).addFields({ name: 'Reason', value: reason || 'No details provided.' });
                await targetUser.send({ embeds: [dm] }).catch(() => {});
            }

        } else if (action === 'blacklist') {
            dbStatus = 'BLACKLISTED';
            embedColor = 0x000000;
            embedTitle = '⛔ Appeal Blacklisted';
            embedDesc = `User has been **BLOCKED** from appealing by <@${moderator.id}>.`;

            await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [appeal.user_id, mainGuild.id]);
            if (targetUser) {
                const dm = new EmbedBuilder().setColor(0x000000).setTitle('⛔ Appeal Blocked').setDescription(`Your appeal was rejected and you are blocked from future appeals.`);
                await targetUser.send({ embeds: [dm] }).catch(() => {});
            }
        }

        await db.query("UPDATE ban_appeals SET status = $1 WHERE id = $2", [dbStatus, appealId]);

        if (appeal.message_id) {
            try {
                const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [process.env.DISCORD_GUILD_ID]);
                
                if (chRes.rows[0]?.channel_id) {
                    const appealChannel = await botClient.channels.fetch(chRes.rows[0].channel_id).catch(() => null);
                    
                    if (appealChannel) {
                        const msg = await appealChannel.messages.fetch(appeal.message_id).catch(() => null);
                        
                        if (msg && msg.editable) {
                           
                            const newEmbed = EmbedBuilder.from(msg.embeds[0])
                                .setColor(embedColor)
                                .setTitle(embedTitle)
                                .setDescription(embedDesc)
                                .setFooter({ text: `${dbStatus} by ${moderator.username}` })
                                .setTimestamp();

                            await msg.edit({ embeds: [newEmbed], components: [] });
                        }
                    }
                } else {
                    console.warn("No appeal channel configured in DB (log_channels). Cannot edit embed.");
                }
            } catch (err) {
                console.error("Error editing Discord message:", err);
            }
        }

        res.json({ success: true });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
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