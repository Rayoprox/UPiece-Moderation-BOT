const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { emojis } = require('../../utils/config.js');
const { success, error, moderation } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Locks the channel so members cannot send messages.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
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
                    content: null,
                    embeds: [error(`Channel ${channel} is **already locked**.`)] 
                });
            }

            await channel.permissionOverwrites.edit(everyoneRole, { 
                SendMessages: false 
            }, { reason: `Lockdown by ${interaction.user.tag}` });

            const lockEmbed = moderation(`**CHANNEL LOCKED**\nThis channel has been placed under lockdown.\n**Reason:** ${reason}`);

            await channel.send({ embeds: [lockEmbed] });

            await interaction.editReply({ 
                content: null,
                embeds: [success(`**Channel Locked Successfully.**`)]
            });

        } catch (err) {
            console.error("Lock Error:", err);
            await interaction.editReply({ 
                content: null,
                embeds: [error(`**Error:** I couldn't lock the channel. check my permissions.\n\`${err.message}\``)] 
            });
        }
    },
};
