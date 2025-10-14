const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType, MessageFlags } = require('discord.js');
const { emojis } = require('../../utils/config.js');

const LOCK_COLOR = 0xAA0000; 
const SUCCESS_COLOR = 0x2ECC71; 

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Locks a channel, preventing members from sending messages.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to lock. Defaults to the current channel.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for locking the channel.')
                .setRequired(false)),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const everyoneRole = interaction.guild.roles.everyone;
        
        const cleanReason = reason.trim();

        const perms = channel.permissionOverwrites.cache.get(everyoneRole.id);
        if (perms && perms.deny.has(PermissionsBitField.Flags.SendMessages)) {
            return interaction.editReply({ content: `${emojis.error} Channel ${channel} is **already locked**!`, flags: [MessageFlags.Ephemeral] });
        }

        try {
            await channel.permissionOverwrites.edit(everyoneRole, {
                SendMessages: false,
            }, `Channel locked by ${interaction.user.tag} for reason: ${cleanReason}`); 

            const lockEmbed = new EmbedBuilder()
                .setColor(LOCK_COLOR)
                .setTitle(`${emojis.lock} Channel Locked Down`)
                .setDescription(`This channel has been **LOCKED**. Members will not be able to send messages until it is unlocked.`)
                .addFields(
                    { name: `${emojis.moderator} Moderator`, value: `${interaction.user.tag}`, inline: true },
                    { name: `${emojis.reason} Reason`, value: cleanReason, inline: false }
                )
                .setTimestamp();
            await channel.send({ embeds: [lockEmbed] });

            await interaction.editReply({ 
                embeds: [new EmbedBuilder()
                    .setColor(SUCCESS_COLOR)
                    .setDescription(`${emojis.success} Successfully **LOCKED** channel ${channel}.`)
                ],
                flags: [MessageFlags.Ephemeral] 
            });

        } catch (error) {
            console.error("Failed to lock channel:", error);
            await interaction.editReply({ 
                content: `${emojis.error} An unexpected error occurred. I may not have the required permissions to manage this channel.`, 
                flags: [MessageFlags.Ephemeral] 
            });
        }
    },
};