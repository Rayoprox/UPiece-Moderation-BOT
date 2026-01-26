const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, StringSelectMenuBuilder } = require('discord.js');
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
        
        const format = (type) => channels[type] ? `<#${channels[type]}>` : '`Not Set`';
        const hasAnyChannel = res.rows.length > 0;

        const embed = new EmbedBuilder()
            .setTitle('📺 Log Channels Configuration')
            .setDescription('Set channels for different logs.')
            .addFields(
                { name: '🔨 Mod Logs', value: format('modlog'), inline: true },
                { name: '💻 Command Logs', value: format('cmdlog'), inline: true },
                { name: '📝 Ban Appeals', value: format('banappeal'), inline: true },
                { name: '☢️ Anti-Nuke', value: format('antinuke'), inline: true }
            )
            .setColor('#3498DB');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_channels_edit').setLabel('Edit Channel').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
            new ButtonBuilder()
                .setCustomId('setup_channels_delete_menu')
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
                .setDisabled(!hasAnyChannel), 
            new ButtonBuilder().setCustomId('setup_home').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

    if (customId === 'setup_channels_edit') {
        if (!await safeDefer(interaction, true)) return;
        
        const options = [
            { label: 'Mod Logs', value: 'modlog', emoji: '🔨' },
            { label: 'Command Logs', value: 'cmdlog', emoji: '💻' },
            { label: 'Ban Appeals', value: 'banappeal', emoji: '📝' },
            { label: 'Anti-Nuke Logs', value: 'antinuke', emoji: '☢️' }
        ];

        const menu = new StringSelectMenuBuilder()
            .setCustomId('setup_channels_select_type')
            .setPlaceholder('Select log type to configure...')
            .addOptions(options);

        const back = new ButtonBuilder().setCustomId('setup_channels').setLabel('Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ 
            embeds: [new EmbedBuilder().setTitle('✏️ Edit Log Channel').setDescription('Select which log type you want to configure.').setColor('#3498DB')], 
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(back)] 
        });
        return;
    }

    if (customId === 'setup_channels_delete_menu') {
        if (!await safeDefer(interaction, true)) return;

        const res = await db.query("SELECT log_type, channel_id FROM log_channels WHERE guildid = $1", [guildId]);
        
        if (res.rows.length === 0) {
            return await module.exports(Object.assign(interaction, { customId: 'setup_channels' })); // Volver si no hay nada
        }

        const typeLabels = {
            'modlog': 'Mod Logs',
            'cmdlog': 'Command Logs',
            'banappeal': 'Ban Appeals',
            'antinuke': 'Anti-Nuke'
        };

        const options = res.rows.map(r => ({
            label: `Reset ${typeLabels[r.log_type] || r.log_type}`,
            value: r.log_type,
            description: `Channel: <#${r.channel_id}>`, 
            emoji: '🗑️'
        }));

        const menu = new StringSelectMenuBuilder()
            .setCustomId('setup_channels_delete_confirm')
            .setPlaceholder('Select channel to reset...')
            .addOptions(options);

        const back = new ButtonBuilder().setCustomId('setup_channels').setLabel('Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ 
            embeds: [new EmbedBuilder().setTitle('🗑️ Delete Log Channel').setDescription('Select the log configuration you want to remove.').setColor('#E74C3C')], 
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(back)] 
        });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'setup_channels_delete_confirm') {
        if (!await safeDefer(interaction, true)) return;
        
        const logType = values[0];
        await db.query("DELETE FROM log_channels WHERE guildid = $1 AND log_type = $2", [guildId, logType]);
        
        const back = new ButtonBuilder().setCustomId('setup_channels').setLabel('Return to Channels').setStyle(ButtonStyle.Primary);
        
        await interaction.editReply({ 
            embeds: [success(`Configuration for **${logType}** has been removed.`)], 
            components: [new ActionRowBuilder().addComponents(back)] 
        });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'setup_channels_select_type') {
        if (!await safeDefer(interaction, true)) return;
        const logType = values[0];
        
        const menu = new ChannelSelectMenuBuilder()
            .setCustomId(`setup_channels_set_${logType}`)
            .setPlaceholder(`Select channel for ${logType}`)
            .addChannelTypes(ChannelType.GuildText);

        const back = new ButtonBuilder().setCustomId('setup_channels_edit').setLabel('Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ 
            embeds: [new EmbedBuilder().setTitle(`Set Channel for: ${logType}`)], 
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(back)] 
        });
        return;
    }

    if (interaction.isChannelSelectMenu() && customId.startsWith('setup_channels_set_')) {
        if (!await safeDefer(interaction, true)) return;
        
        const logType = customId.replace('setup_channels_set_', '');
        
        await db.query("INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT (guildid, log_type) DO UPDATE SET channel_id = $3", [guildId, logType, values[0]]);
        
        const back = new ButtonBuilder().setCustomId('setup_channels').setLabel('Back to Channels').setStyle(ButtonStyle.Primary);
        
        await interaction.editReply({ 
            embeds: [success(`${logType} channel updated to <#${values[0]}>`)], 
            components: [new ActionRowBuilder().addComponents(back)] 
        });
        return;
    }
};