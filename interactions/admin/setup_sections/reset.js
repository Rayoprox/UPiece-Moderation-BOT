const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../../utils/db.js');
const { success, error } = require('../../../utils/embedFactory.js');
const { safeDefer } = require('../../../utils/interactionHelpers.js');

module.exports = async (interaction) => {
    const { customId, guild } = interaction;
    const guildId = guild.id;

    if (customId === 'delete_all_data') {
        if (!await safeDefer(interaction, false, true)) return; 
        
        const confirmBtn = new ButtonBuilder()
            .setCustomId('confirm_delete_data')
            .setLabel('CONFIRM DELETION')
            .setStyle(ButtonStyle.Danger);
            
        const cancelBtn = new ButtonBuilder()
            .setCustomId('setup_home')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ 
            embeds: [error('⚠️ **DANGER ZONE** ⚠️\nThis will delete ALL configuration, logs, rules and appeals for this server.\nThis action cannot be undone.')], 
            components: [new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)] 
        });
        return;
    }

    if (customId === 'confirm_delete_data') {
        if (!await safeDefer(interaction, true)) return;
        
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

        await interaction.editReply({ embeds: [success('All data for this guild has been wiped from the database.')], components: [] });
        return;
    }
};
