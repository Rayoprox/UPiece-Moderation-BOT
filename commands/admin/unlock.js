const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { emojis } = require('../../utils/config.js');
const { success, error, moderation } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlocks the channel allowing members to speak.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to unlock (Defaults to current).')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for unlocking.')
                .setRequired(false)),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || 'Channel restored.';

        await interaction.editReply({ 
            content: `${emojis.loading} **Unlocking Channel...**` 
        });

        try {
            const everyoneRole = interaction.guild.roles.everyone;
            
            await channel.permissionOverwrites.edit(everyoneRole, { 
                SendMessages: null 
            }, { reason: `Unlock by ${interaction.user.tag}` });

            const unlockEmbed = moderation(`**CHANNEL UNLOCKED**\nLockdown lifted. Members may now send messages.\n**Reason:** ${reason}`);

            await channel.send({ embeds: [unlockEmbed] });

            await interaction.editReply({ 
                content: null,
                embeds: [success(`**Channel Unlocked Successfully.**`)]
            });

        } catch (err) {
            console.error("Unlock Error:", err);
            await interaction.editReply({ 
                content: null,
                embeds: [error(`**Error:** I couldn't unlock the channel.\n\`${err.message}\``)] 
            });
        }
    },
};
