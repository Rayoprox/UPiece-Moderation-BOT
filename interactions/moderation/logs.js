const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { emojis } = require('../../utils/config.js');
const { safeDefer, generateLogEmbed } = require('../../utils/interactionHelpers.js');

module.exports = async (interaction) => {
    const { customId, client, guild, values } = interaction;
    const parts = customId.split('_');
    const db = client.db;
    const guildId = guild.id;
    const logsPerPage = 5;

    
    const logsAuthorId = parts[parts.length - 1];
    if (interaction.user.id !== logsAuthorId) {
        return interaction.reply({ content: `${emojis.error} Only the command author can use these buttons.`, flags: [MessageFlags.Ephemeral] });
    }

    const action = parts[1]; 
    const userId = parts[2]; 

    if (action === 'next' || action === 'prev') {
        await safeDefer(interaction, true);
        const targetUser = await client.users.fetch(userId);
        const isWarningLog = parts[0] === 'warns';
        const logsResult = await db.query(`SELECT * FROM modlogs WHERE userid = $1 AND guildid = $2 ${isWarningLog ? "AND action = 'WARN'" : ""} ORDER BY timestamp DESC`, [userId, guildId]);
        const logs = logsResult.rows;
        const totalPages = Math.ceil(logs.length / logsPerPage);
        let currentPage = 0;
        try { currentPage = parseInt(interaction.message.embeds[0].footer.text.split(' ')[1], 10) - 1; } catch(e) {}
        if (isNaN(currentPage)) currentPage = 0;
        currentPage += (action === 'next' ? 1 : -1);
        const { embed, components } = generateLogEmbed(logs, targetUser, currentPage, totalPages, logsAuthorId, isWarningLog, logsPerPage);
        await interaction.editReply({ embeds: [embed], components });
    }

    if (action === 'purge-prompt') {
            await safeDefer(interaction, false, true);
            const btns = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`modlogs_purge-confirm_${userId}_${logsAuthorId}`).setLabel('DELETE ALL').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`modlogs_purge-cancel_${userId}_${logsAuthorId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
            await interaction.editReply({ content: `⚠️ **CRITICAL WARNING:** This will delete ALL logs for <@${userId}>.`, components: [btns] });
    }
    if (action === 'purge-confirm') {
        await safeDefer(interaction, true);
        await db.query("DELETE FROM modlogs WHERE userid = $1 AND guildid = $2", [userId, guildId]);
        await interaction.editReply({ content: `✅ Logs purged.`, components: [] });
        await interaction.message.edit({ embeds: [new EmbedBuilder().setTitle('Logs Purged').setColor(0xAA0000)], components: [] }).catch(() => {});
    }
    if (action === 'purge-cancel') return interaction.update({ content: `Cancelled.`, components: [] });
    
    if (action === 'remove-start') {
        await safeDefer(interaction, false, true);
        const activeWarnings = await db.query("SELECT caseid, reason FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'WARN' AND status = 'ACTIVE' ORDER BY timestamp DESC", [userId, guildId]);
        if (activeWarnings.rows.length === 0) return interaction.editReply("No active warnings to remove.");
        const menu = new StringSelectMenuBuilder().setCustomId(`warns_remove-select_${userId}_${logsAuthorId}`).setPlaceholder('Select warning to annul...').addOptions(activeWarnings.rows.map(w => ({ label: `Case ${w.caseid}`, description: w.reason.substring(0, 50), value: w.caseid })));
        await interaction.editReply({ content: "Select warning:", components: [new ActionRowBuilder().addComponents(menu)] });
    }
    if (action === 'remove-select') {
        await safeDefer(interaction, true);
        const caseIdToRemove = values[0];
        await db.query("UPDATE modlogs SET status = 'REMOVED' WHERE caseid = $1 AND guildid = $2", [caseIdToRemove, guildId]);
        try {
            const logData = await db.query("SELECT logmessageid FROM modlogs WHERE caseid = $1", [caseIdToRemove]);
            if (logData.rows[0]?.logmessageid) {
                const chRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type='modlog'", [guildId]);
                const channel = await client.channels.fetch(chRes.rows[0].channel_id);
                const msg = await channel.messages.fetch(logData.rows[0].logmessageid);
                if (msg) await msg.edit({ embeds: [EmbedBuilder.from(msg.embeds[0]).setColor(0x95A5A6).setTitle(`${emojis.warn} Warning Annulled`).setFooter({ text: `Case ${caseIdToRemove} | REMOVED` })] });
            }
        } catch(e) {}
        await interaction.editReply({ content: `✅ Warning ${caseIdToRemove} removed.`, components: [] });
    }
};