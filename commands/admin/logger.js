const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { setWebhook } = require('../../utils/logger.js');

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
       
        if (interaction.user.id !== '715926664344895559') {
            return interaction.editReply({ content: '❌ Access Denied: This command is restricted to the bot developer.' });
        }

        const url = interaction.options.getString('url');

        try {
            const success = await setWebhook(url);
            if (success) {
                await interaction.editReply({ 
                    content: '✅ **Persistent Logger Activated.** All console logs are now being mirrored to your channel and saved in the Database.' 
                });
                console.log(`📡 Remote Mirror enabled by ${interaction.user.tag}`);
            } else {
                await interaction.editReply({ content: '❌ Invalid Webhook URL. Please check it and try again.' });
            }
        } catch (err) {
            console.error('Error in logger command:', err);
        }
    },
};