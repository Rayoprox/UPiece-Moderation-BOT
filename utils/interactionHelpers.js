const { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { emojis } = require('./config.js');

async function smartReply(interaction, payload, ephemeral = false) {
    try {
        const options = typeof payload === 'string' ? { content: payload } : payload;
        if (ephemeral) options.flags = [MessageFlags.Ephemeral];

        if (interaction.replied || interaction.deferred) {
            if (interaction.replied) return await interaction.followUp(options);
            return await interaction.editReply(options);
        } else {
            return await interaction.reply(options);
        }
    } catch (error) {
        if (error.code === 10062 || error.code === 40060) return;
        console.error(`[SMART-REPLY ERROR]`, error);
    }
}

async function safeDefer(interaction, isUpdate = false, isEphemeral = false) {
    try {
        if (interaction.deferred || interaction.replied) return true;
        if (isUpdate) {
            await interaction.deferUpdate();
        } else {
            const options = isEphemeral ? { flags: [MessageFlags.Ephemeral] } : {};
            await interaction.deferReply(options);
        }
        return true;
    } catch (error) {
        if (error.code === 40060) return true;
        if (error.code === 10062) return false;
        console.error(`[DEFER ERROR]`, error);
        return false;
    }
}

async function verifyAppealEligibility(userId, mainGuild, db) {
    const banEntry = await mainGuild.bans.fetch({ user: userId, force: true }).catch(() => null);
    if (!banEntry) {
        await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [userId, mainGuild.id]);
        return { valid: false, message: `${emojis.error} You are not currently banned from **${mainGuild.name}**.` };
    }
    const blacklistResult = await db.query("SELECT * FROM appeal_blacklist WHERE userid = $1 AND guildid = $2", [userId, mainGuild.id]);
    if (blacklistResult.rows.length > 0) return { valid: false, message: `${emojis.error} You are **blacklisted** from the appeal system.` };

    const pendingResult = await db.query("SELECT appeal_messageid FROM pending_appeals WHERE userid = $1 AND guildid = $2", [userId, mainGuild.id]);
    if (pendingResult.rows.length > 0) {
        const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [mainGuild.id]);
        if (chRes.rows.length > 0) {
            const channel = mainGuild.channels.cache.get(chRes.rows[0].channel_id);
            if (channel) {
                try {
                    await channel.messages.fetch(pendingResult.rows[0].appeal_messageid);
                    return { valid: false, message: `${emojis.error} You already have an active appeal pending review.` };
                } catch (e) {
                    await db.query("DELETE FROM pending_appeals WHERE userid = $1 AND guildid = $2", [userId, mainGuild.id]);
                }
            }
        }
    }
    const banLog = await db.query("SELECT endsat FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'BAN' AND (status = 'ACTIVE' OR status = 'PERMANENT') ORDER BY timestamp DESC LIMIT 1", [userId, mainGuild.id]);
    if (banLog.rows[0]?.endsat) {
        const endsAtTimestamp = Math.floor(Number(banLog.rows[0].endsat) / 1000);
        return { valid: false, message: `${emojis.error} Temporary bans are not appealable. Expires: <t:${endsAtTimestamp}:f>.` };
    }
    return { valid: true };
}

const generateLogEmbed = (logs, targetUser, page, totalPages, authorId, isWarningLog = false, logsPerPage = 5) => {
    const start = page * logsPerPage;
    const currentLogs = logs.slice(start, start + logsPerPage);
    const description = currentLogs.map(log => {
        const timestamp = Math.floor(Number(log.timestamp) / 1000);
        const action = log.action.charAt(0).toUpperCase() + log.action.slice(1).toLowerCase();
        const isRemoved = log.status === 'REMOVED' || log.status === 'VOIDED';
        const text = `**${action}** - <t:${timestamp}:f> (\`${log.caseid}\`)\n**Moderator:** ${log.moderatortag}\n**Reason:** ${log.reason}`;
        return isRemoved ? `~~${text}~~` : text;
    }).join('\n\n') || "No logs found for this page.";

    const embed = new EmbedBuilder()
        .setColor(isWarningLog ? 0xFFA500 : 0x3498DB)
        .setTitle(`${isWarningLog ? emojis.warn : emojis.info} ${isWarningLog ? 'Warnings' : 'Moderation Logs'} for ${targetUser.tag}`)
        .setDescription(description)
        .setFooter({ text: `Page ${page + 1} of ${totalPages} | Total Logs: ${logs.length}` });
        
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${isWarningLog ? 'warns' : 'modlogs'}_prev_${targetUser.id}_${authorId}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`${isWarningLog ? 'warns' : 'modlogs'}_next_${targetUser.id}_${authorId}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
        new ButtonBuilder().setCustomId(`modlogs_purge-prompt_${targetUser.id}_${authorId}`).setLabel('Purge All Modlogs').setStyle(ButtonStyle.Danger).setDisabled(isWarningLog)
    );
    return { embed, components: [buttons] };
};

module.exports = { smartReply, safeDefer, verifyAppealEligibility, generateLogEmbed };