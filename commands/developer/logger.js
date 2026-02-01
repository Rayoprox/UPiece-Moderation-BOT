const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { setWebhook } = require('../../utils/logger.js'); 
const { moderation, error } = require('../../utils/embedFactory.js'); 
const { DEVELOPER_IDS } = require('../../utils/config.js'); 
module.exports = {
    deploy: 'global',
    data: new SlashCommandBuilder()
        .setName('logger')
        .setDescription('Set the Webhook for persistent console mirroring.')
        .addStringOption(option => 
            option.setName('url')
                .setDescription('The Webhook URL')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });
        
   
        if (!DEVELOPER_IDS.includes(interaction.user.id)) {
            return interaction.editReply({ embeds: [error('⛔ **Developer Only**\nThis command is restricted to bot developers.')] });
        }
   

        const url = interaction.options.getString('url');
        const success = await setWebhook(url);
        
        if (success) {
            await interaction.editReply({ embeds: [moderation('**Persistent Logger Activated**\nConsole logs mirrored to this channel.')] });
            console.log(`📡 Remote Mirror enabled by ${interaction.user.tag}`);
        } else {
            await interaction.editReply({ embeds: [error('Invalid Webhook URL.')] });
        }
    },
};