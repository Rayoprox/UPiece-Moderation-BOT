const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    async generateSetupContent(interaction, guildId) {
        const embed = new EmbedBuilder()
            .setTitle('🛠️ Main Setup Panel')
            .setDescription('Select a category to configure your server systems.')
            .addFields(
                { name: '📺 Channels', value: 'Configure logging, welcome, and report channels.', inline: true },
                { name: '🤖 Automod', value: 'Open Anti-Mention, Anti-Spam and Auto-Punishment subsystems.', inline: true },
                { name: '🔐 Permissions', value: 'Manage Staff Roles and Command Overrides.', inline: true },
                { name: '🛡️ Protection', value: 'Anti-Nuke system and Lockdown configuration.', inline: true },
                { name: '🎫 Tickets', value: 'Create and manage support ticket panels.', inline: true },
                { name: '🔒 Verification', value: 'User verification system with ban evasion detection.', inline: true },
                { name: '⌨️ Prefix', value: 'Change the server prefix.', inline: true }
            )
            .setColor('#2B2D31') 
            .setThumbnail(interaction.guild.iconURL({ dynamic: true }));

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_channels').setLabel('Channels').setStyle(ButtonStyle.Primary).setEmoji('📺'),
            new ButtonBuilder().setCustomId('setup_automod').setLabel('Automod').setStyle(ButtonStyle.Success).setEmoji('🤖'),
            new ButtonBuilder().setCustomId('setup_menu_permissions').setLabel('Permissions').setStyle(ButtonStyle.Primary).setEmoji('🔐'),
            new ButtonBuilder().setCustomId('setup_menu_protection').setLabel('Protection').setStyle(ButtonStyle.Danger).setEmoji('🛡️'),
            new ButtonBuilder().setCustomId('setup_tickets_menu').setLabel('Tickets').setStyle(ButtonStyle.Primary).setEmoji('🎫')
        );

        const row2 = new ActionRowBuilder().addComponents(
             new ButtonBuilder().setCustomId('setup_verification').setLabel('Verification').setStyle(ButtonStyle.Primary).setEmoji('🔒'),
             new ButtonBuilder().setCustomId('setup_prefix').setLabel('Custom Prefix').setStyle(ButtonStyle.Secondary).setEmoji('⌨️'),
             new ButtonBuilder().setCustomId('setup_cc_menu').setLabel('Custom Commands').setStyle(ButtonStyle.Secondary).setEmoji('⚡')
        );
        
        const row3 = new ActionRowBuilder().addComponents(
             new ButtonBuilder().setCustomId('delete_all_data').setLabel('Reset Data').setStyle(ButtonStyle.Secondary).setEmoji('🗑️')
        );

        return { embed, components: [row, row2, row3] };
    }
};
