const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { emojis } = require('../../utils/config.js');

const UNLOCK_COLOR = 0x2ECC71;

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlocks the channel allowing members to speak.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
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

            const unlockEmbed = new EmbedBuilder()
                .setColor(UNLOCK_COLOR)
                .setTitle(`${emojis.unlock} CHANNEL UNLOCKED`)
                .setDescription(`Lockdown lifted. Members may now send messages.`)
                .addFields(
                    { name: `${emojis.moderator} Moderator`, value: `<@${interaction.user.id}>`, inline: true },
                    { name: `${emojis.reason} Reason`, value: reason, inline: true }
                )
                .setTimestamp();

            await channel.send({ embeds: [unlockEmbed] });

            await interaction.editReply({ 
                content: null,
                embeds: [new EmbedBuilder()
                    .setColor(UNLOCK_COLOR)
                    .setDescription(`${emojis.success} **Channel Unlocked Successfully.**`)
                ]
            });

        } catch (error) {
            console.error("Unlock Error:", error);
            await interaction.editReply({ 
                content: `${emojis.error} **Error:** I couldn't unlock the channel.\n\`${error.message}\`` 
            });
        }
    },
};