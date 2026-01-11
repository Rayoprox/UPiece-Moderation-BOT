const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { emojis } = require('../../utils/config.js');

const LOCK_COLOR = 0xE74C3C;

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Locks the channel so members cannot send messages.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to lock (Defaults to current).')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the lockdown.')
                .setRequired(false)),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || 'No specific reason provided.';

      
        await interaction.editReply({ 
            content: `${emojis.loading} **Locking Channel...**` 
        });

        try {
            const everyoneRole = interaction.guild.roles.everyone;

         
            const currentPerms = channel.permissionOverwrites.cache.get(everyoneRole.id);
            if (currentPerms && currentPerms.deny.has(PermissionsBitField.Flags.SendMessages)) {
                return interaction.editReply({ 
                    content: `${emojis.error} Channel ${channel} is **already locked**.` 
                });
            }

            await channel.permissionOverwrites.edit(everyoneRole, { 
                SendMessages: false 
            }, { reason: `Lockdown by ${interaction.user.tag}` });

            const lockEmbed = new EmbedBuilder()
                .setColor(LOCK_COLOR)
                .setTitle(`${emojis.lock} CHANNEL LOCKED`)
                .setDescription(`This channel has been placed under **lockdown**.`)
                .addFields(
                    { name: `${emojis.moderator} Moderator`, value: `<@${interaction.user.id}>`, inline: true },
                    { name: `${emojis.reason} Reason`, value: reason, inline: true }
                )
                .setFooter({ text: 'Members cannot send messages.' })
                .setTimestamp();

            await channel.send({ embeds: [lockEmbed] });

            await interaction.editReply({ 
                content: null,
                embeds: [new EmbedBuilder()
                    .setColor(LOCK_COLOR)
                    .setDescription(`${emojis.success} **Channel Locked Successfully.**`)
                ]
            });

        } catch (error) {
            console.error("Lock Error:", error);
            await interaction.editReply({ 
                content: `${emojis.error} **Error:** I couldn't lock the channel. check my permissions.\n\`${error.message}\`` 
            });
        }
    },
};