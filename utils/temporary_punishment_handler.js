const ms = require('ms');
const { EmbedBuilder, Collection } = require('discord.js');
const { emojis } = require('./config.js');

function initializeTimerMap(client) {
    if (!client.punishmentTimers) {
        client.punishmentTimers = new Collection();
    }
}

const processExpiredPunishment = async (client, log) => {
    initializeTimerMap(client);
    const db = client.db;
    const guild = client.guilds.cache.get(log.guildid);
    if (!guild) return;
    
    const activeCheck = await db.query('SELECT status FROM modlogs WHERE caseid = $1', [log.caseid]);
    if (activeCheck.rows.length === 0 || activeCheck.rows[0].status !== 'ACTIVE') {
         return; 
    }

    const action = log.action;
    const userId = log.userid;
    const caseId = log.caseid;
    const reason = `${action} expired (Auto-Lift)`;
    const currentTimestamp = Date.now();

    try {
        if (action === 'BAN') {
            await guild.bans.remove(userId, reason).catch(() => {});
        } else if (action === 'TIMEOUT') {
             const member = await guild.members.fetch(userId).catch(() => null);
             if (member && member.isCommunicationDisabled()) {
                 await member.timeout(null, reason).catch(() => {});
             }
        }
        
        await db.query(`UPDATE modlogs SET status = 'EXPIRED', "endsat" = NULL WHERE caseid = $1`, [caseId]);
        console.log(`[SCHEDULER] Auto-expired ${action} for ${log.usertag} (Case ID: ${caseId}).`);

        const logActionType = action === 'BAN' ? 'UNBAN' : 'UNMUTE';
        const autoCaseId = `AUTO-${logActionType}-${currentTimestamp}`;

        await db.query(`
            INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [autoCaseId, guild.id, logActionType, userId, log.usertag, client.user.id, client.user.tag, reason, currentTimestamp, 'EXECUTED']);
        
        const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'modlog'", [guild.id]);
        const modLogChannelId = modLogResult.rows[0]?.channel_id;
        
        if (modLogChannelId) {
            const channel = guild.channels.cache.get(modLogChannelId);
            if (channel) {
                 const modLogEmbed = new EmbedBuilder()
                    .setColor(0x2B2D31) 
                    .setTitle(`Punishment Expired: ${logActionType}`)
                    .setDescription(`The temporary ${action.toLowerCase()} for **${log.usertag}** has expired.`)
                    .addFields(
                        { name: 'User', value: `${log.usertag} (${userId})`, inline: true },
                        { name: 'Moderator', value: `${client.user.tag} (System)`, inline: true },
                        { name: 'Reason', value: `Automatic lift: Original punishment (**${caseId}**) has expired.`, inline: false }
                    )
                    .setFooter({ text: `Auto Case ID: ${autoCaseId}` })
                    .setTimestamp();
                    
                 const sentMessage = await channel.send({ embeds: [modLogEmbed] }).catch(console.error);
                 
                 if (sentMessage) {
                     await db.query("UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2", [sentMessage.id, autoCaseId]);
                 }
            }
        }
    } catch (error) {
        await db.query(`UPDATE modlogs SET status = 'EXPIRED', "endsat" = NULL WHERE caseid = $1`, [caseId]);
        console.warn(`[SCHEDULER] Failed to auto-lift ${action} for ${log.usertag}. Error: ${error.message}`);
    }
};

const checkAndResumePunishments = async (client) => {
    try {
        initializeTimerMap(client);
        const db = client.db;
        const now = Date.now();

        const checkWindow = now + ms('16m'); 
        
        const activeResult = await db.query(`
            SELECT * FROM modlogs 
            WHERE status = 'ACTIVE' 
            AND "endsat" IS NOT NULL 
            AND "endsat" > $1 
            AND "endsat" <= $2
        `, [now, checkWindow]);

        for (const log of activeResult.rows) {
            if (client.punishmentTimers.has(log.caseid)) continue;

            const endsAtTimestamp = Number(log.endsat);
            const remainingTime = endsAtTimestamp - now;
            
            if (remainingTime <= 0) {
                processExpiredPunishment(client, log);
                continue;
            }
            
            const timer = setTimeout(() => {
                processExpiredPunishment(client, log);
                client.punishmentTimers.delete(log.caseid);
            }, remainingTime);

            client.punishmentTimers.set(log.caseid, timer);
        }
    } catch (error) {
        console.error("[SCHEDULER-ERROR] Failed to check punishments:", error.message);
    }
};

const resumePunishmentsOnStart = async (client) => {
    const db = client.db;
    const now = Date.now();
    
    const expiredResult = await db.query(`SELECT * FROM modlogs WHERE status = 'ACTIVE' AND "endsat" IS NOT NULL AND "endsat" <= $1`, [now]);
    for (const log of expiredResult.rows) {
        await processExpiredPunishment(client, log);
    }

    await checkAndResumePunishments(client);
    
    const logsResult = await db.query(`SELECT usertag, action, endsat, action_duration FROM modlogs WHERE status = 'ACTIVE' AND "endsat" IS NOT NULL ORDER BY "endsat" ASC`);
    
    if (logsResult.rows.length > 0) {
        console.log('\n--- ACTIVE TEMPORARY PUNISHMENTS (Database View) ---');
        console.log(`Total Active Punishments: ${logsResult.rows.length}`);
      
        for (const log of logsResult.rows.slice(0, 5)) {
            const remaining = ms(Number(log.endsat) - Date.now(), { long: true });
            console.log(`[PENDING] ${log.action} | User: ${log.usertag} | Ends in: ${remaining}`);
        }
        if (logsResult.rows.length > 5) console.log(`... and ${logsResult.rows.length - 5} more.`);
        console.log('----------------------------------------------------\n');
    }
 
    return logsResult.rows.length;
};

const startScheduler = (client) => {
    if (client.schedulerStarted) {
        return;
    }
    client.schedulerStarted = true;

    setInterval(() => checkAndResumePunishments(client), ms('15m'));
};

module.exports = { startScheduler, resumePunishmentsOnStart, initializeTimerMap };