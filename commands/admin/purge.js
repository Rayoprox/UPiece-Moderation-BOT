const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const { emojis } = require('../../utils/config.js');
const { success, error, moderation } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    isPublic: true, 
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Deletes a specified number of messages from the channel (Max 100).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('The number of messages to delete (between 1 and 100).')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)),

    async execute(interaction) {
        const amount = interaction.options.getInteger('amount');
        const channel = interaction.channel;
        const moderatorTag = interaction.user.tag;
        
        if (!channel.permissionsFor(interaction.client.user).has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.editReply({ 
                content: null,
                embeds: [error(`I do not have the **Manage Messages** permission in this channel.`)]
            });
        }
        
        let deletedCount = 0;
        
        try {
            const messages = await channel.messages.fetch({ limit: amount });
            const result = await channel.bulkDelete(messages, true);
            deletedCount = result.size;

        } catch (err) {
            console.error('[ERROR] Failed to execute purge:', err);
            return interaction.editReply({ embeds: [error('An unexpected error occurred during message deletion. Remember I cannot delete messages older than 14 days.')] });
        }
        
        let description = `**Message Purge Complete**\nDeleted **${deletedCount}** message(s) in <#${channel.id}>.`;
        
        if (deletedCount < amount) {
            description += `\n\n${emojis.warn || '⚠️'} **Note:** ${amount - deletedCount} message(s) could not be deleted because they are older than 14 days.`;
        }

        const publicEmbed = moderation(description);

        try {
            await interaction.editReply({ 
                content: null,
                embeds: [publicEmbed]
            });
            
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000); 
        } catch (err) {
            if (err.code !== 10008) {
                 console.warn('[WARN] Failed to edit or delete the final purge interaction reply:', err);
            }
        }
    },
};
