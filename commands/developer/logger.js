const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { setWebhook } = require('../../utils/logger.js'); 
const { moderation, error } = require('../../utils/embedFactory.js'); 
const { DEVELOPER_IDS } = require('../../utils/config.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('logger')
        .setDescription('Set the Webhook for persistent console mirroring.')
        .addStringOption(option => 
            option.setName('url')
                .setDescription('The Webhook URL')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
       
        await interaction.deferReply({ ephemeral: true });
        
       
        if (!DEVELOPER_IDS.includes(interaction.user.id)) {
            return interaction.editReply({ embeds: [error('Access Denied: This command is restricted to the bot developer.')] });
        }

        const url = interaction.options.getString('url');

        try {
            const success = await setWebhook(url);
            
            if (success) {
                const embed = moderation('**Persistent Logger Activated**\nAll console logs are now being mirrored to your channel and saved in the Database.');
                await interaction.editReply({ embeds: [embed] });
                console.log(`📡 Remote Mirror enabled by ${interaction.user.tag}`);
            } else {
                await interaction.editReply({ embeds: [error('Invalid Webhook URL. Please check it and try again.')] });
            }
        } catch (err) {
            console.error('Error in logger command:', err);
            await interaction.editReply({ embeds: [error('An unexpected error occurred.')] });
        }
    },
};