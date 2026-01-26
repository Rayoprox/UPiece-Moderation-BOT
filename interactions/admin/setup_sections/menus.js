const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const db = require('../../../utils/db.js');
const { success } = require('../../../utils/embedFactory.js');
const { safeDefer } = require('../../../utils/interactionHelpers.js');

module.exports = async (interaction) => {
    const { customId, guild, values } = interaction;
    const guildId = guild.id;

   
    if (customId === 'setup_menu_permissions') {
        if (!await safeDefer(interaction, true)) return;

        const embed = new EmbedBuilder()
            .setTitle('🔐 Permissions Configuration')
            .setDescription('Choose a sub-category to configure.')
            .setColor('#9B59B6');
            
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_staff').setLabel('Staff Roles').setStyle(ButtonStyle.Secondary).setEmoji('👮'),
            new ButtonBuilder().setCustomId('setup_permissions').setLabel('Command Permissions').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
            new ButtonBuilder().setCustomId('setup_home').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );
        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

 
    if (customId === 'setup_menu_protection') {
        if (!await safeDefer(interaction, true)) return;

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Protection Systems')
            .setDescription('Configure server defense and emergency systems.')
            .setColor('#E74C3C');
            
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_antinuke').setLabel('Anti-Nuke').setStyle(ButtonStyle.Danger).setEmoji('☢️'),
            new ButtonBuilder().setCustomId('setup_lockdown_menu').setLabel('Lockdown Config').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
            new ButtonBuilder().setCustomId('setup_home').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );
        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

    if (customId === 'setup_lockdown_menu') {
        if (!await safeDefer(interaction, true)) return;
        
        const res = await db.query("SELECT channel_id FROM lockdown_channels WHERE guildid = $1", [guildId]);
        const hasChannels = res.rows.length > 0;
        const currentChannels = hasChannels 
            ? res.rows.map(r => `<#${r.channel_id}>`).join(', ') 
            : 'None';

        const embed = new EmbedBuilder()
            .setTitle('🔒 Lockdown Configuration')
            .setDescription(`Select channels to lock/hide during \`/lockdown\`.\n\n**Current:**\n${currentChannels}`)
            .setColor('#E74C3C');

        const select = new ChannelSelectMenuBuilder()
            .setCustomId('select_lockdown_channels')
            .setPlaceholder('Select channels...')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice)
            .setMinValues(0)
            .setMaxValues(25);

        const rowSelect = new ActionRowBuilder().addComponents(select);
    
        const rowButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_menu_protection').setLabel('Back').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('setup_lockdown_reset') 
                .setLabel('Reset')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
                .setDisabled(!hasChannels) 
        );

        await interaction.editReply({ embeds: [embed], components: [rowSelect, rowButtons] });
        return;
    }

   
    if (interaction.isChannelSelectMenu() && customId === 'select_lockdown_channels') {
        if (!await safeDefer(interaction, true)) return;
        
        await db.query("DELETE FROM lockdown_channels WHERE guildid = $1", [guildId]);
        for (const chId of values) { 
            await db.query("INSERT INTO lockdown_channels (guildid, channel_id) VALUES ($1, $2)", [guildId, chId]); 
        }
        
        const back = new ButtonBuilder().setCustomId('setup_lockdown_menu').setLabel('Back to Config').setStyle(ButtonStyle.Primary);
        await interaction.editReply({ embeds: [success(`Lockdown channels updated: ${values.length} channels.`)], components: [new ActionRowBuilder().addComponents(back)] });
        return;
    }

   
    if (customId === 'setup_lockdown_reset') {
        if (!await safeDefer(interaction, true)) return;

        await db.query("DELETE FROM lockdown_channels WHERE guildid = $1", [guildId]);
        
       
        interaction.customId = 'setup_lockdown_menu';
        return module.exports(interaction);
    }
};