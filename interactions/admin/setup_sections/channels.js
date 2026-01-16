const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const db = require('../../../utils/db.js');
const { success, error } = require('../../../utils/embedFactory.js');
const { safeDefer } = require('../../../utils/interactionHelpers.js');

module.exports = async (interaction) => {
    const { customId, guild, values } = interaction;
    const guildId = guild.id;

    if (customId === 'setup_channels') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT log_type, channel_id FROM log_channels WHERE guildid = $1", [guildId]);
        const channels = {};
        res.rows.forEach(r => channels[r.log_type] = r.channel_id);
        const formatCh = (id) => id ? `<#${id}>` : '`Not Configured`';

        const embed = new EmbedBuilder().setTitle('📜 Logging Channels Config').setDescription('Current configuration for log channels.').setColor(0x3498DB)
            .addFields({ name: '🛡️ Moderation Logs', value: formatCh(channels['modlog']), inline: true }, { name: '🔨 Ban Appeals', value: formatCh(channels['banappeal']), inline: true }, { name: '💻 Command Logs', value: formatCh(channels['cmdlog']), inline: true }, { name: '☢️ Anti-Nuke Logs', value: formatCh(channels['antinuke']), inline: true });
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels_edit').setLabel('Edit Channels').setStyle(ButtonStyle.Primary).setEmoji('✏️'), new ButtonBuilder().setCustomId('setup_channels_delete').setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️'), new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

    if (customId === 'setup_channels_edit') {
        if (!await safeDefer(interaction, true)) return;
        const modlog = new ChannelSelectMenuBuilder().setCustomId('select_modlog_channel').setPlaceholder('Set ModLog Channel').setChannelTypes([ChannelType.GuildText]);
        const appeal = new ChannelSelectMenuBuilder().setCustomId('select_banappeal_channel').setPlaceholder('Set Ban Appeal Channel').setChannelTypes([ChannelType.GuildText]);
        const cmdlog = new ChannelSelectMenuBuilder().setCustomId('select_cmdlog_channel').setPlaceholder('Set Cmd Log Channel').setChannelTypes([ChannelType.GuildText]);
        const antinuke = new ChannelSelectMenuBuilder().setCustomId('select_antinuke_channel').setPlaceholder('Set Anti-Nuke Log Channel').setChannelTypes([ChannelType.GuildText]);
        const backButton = new ButtonBuilder().setCustomId('setup_channels').setLabel('⬅️ Back to View').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✏️ Edit Logging Channels').setDescription('Select the channels below to update configuration.')], components: [new ActionRowBuilder().addComponents(modlog), new ActionRowBuilder().addComponents(appeal), new ActionRowBuilder().addComponents(cmdlog), new ActionRowBuilder().addComponents(antinuke), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (customId === 'setup_channels_delete') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT log_type FROM log_channels WHERE guildid = $1", [guildId]);
        if (res.rows.length === 0) return interaction.editReply({ embeds: [error("No channels configured to delete.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('Back').setStyle(ButtonStyle.Secondary))]});
        const options = res.rows.map(r => ({ label: `Delete ${r.log_type.toUpperCase()}`, value: r.log_type, emoji: '🗑️' }));
        const menu = new StringSelectMenuBuilder().setCustomId('select_delete_channel').setPlaceholder('Select channel to REMOVE config').addOptions(options);
        const backButton = new ButtonBuilder().setCustomId('setup_channels').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🗑️ Delete Channel Config').setDescription('Select the log type to remove from database.').setColor(0xE74C3C)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'select_delete_channel') {
        await safeDefer(interaction, true);
        await db.query("DELETE FROM log_channels WHERE guildid = $1 AND log_type = $2", [guildId, values[0]]);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('Return to View').setStyle(ButtonStyle.Primary));
        await interaction.editReply({ embeds: [success(`Configuration for **${values[0]}** deleted.`)], components: [row] });
        return;
    }

    if (interaction.isChannelSelectMenu() && customId.endsWith('_channel')) {
        await safeDefer(interaction, true);
        const logType = customId.replace('select_', '').replace('_channel', '');
        await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT(guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, logType, values[0]]);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('Return to Channels View').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('setup_channels_edit').setLabel('Keep Editing').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ embeds: [success(`Channel for **${logType}** updated to <#${values[0]}>`)], components: [row] });
        return;
    }
};