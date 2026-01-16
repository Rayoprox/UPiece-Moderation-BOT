const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const discordTranscripts = require('discord-html-transcripts');
const { success, error } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main', 
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Manage support tickets.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addSubcommand(sub => 
            sub.setName('add')
                .setDescription('Add a user to this ticket.')
                .addUserOption(opt => opt.setName('user').setDescription('User to add').setRequired(true)))
        .addSubcommand(sub => 
            sub.setName('remove')
                .setDescription('Remove a user from this ticket.')
                .addUserOption(opt => opt.setName('user').setDescription('User to remove').setRequired(true)))
        .addSubcommand(sub => 
            sub.setName('rename')
                .setDescription('Rename this ticket.')
                .addStringOption(opt => opt.setName('name').setDescription('New name (e.g., support-high)').setRequired(true)))
        .addSubcommand(sub => 
            sub.setName('claim')
                .setDescription('Claim this ticket as yours.'))
        .addSubcommand(sub => 
            sub.setName('close')
                .setDescription('Force close this ticket with a reason.')
                .addStringOption(opt => opt.setName('reason').setDescription('Reason for closing').setRequired(false))),

    async execute(interaction) {
        try {
      
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: true }); 
            }

            const { options, channel, guild, client, user, member } = interaction;
            const db = client.db;
            const subcommand = options.getSubcommand();

            const ticketRes = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channel.id]);
            if (ticketRes.rows.length === 0) {
                return interaction.editReply({ embeds: [error('This command can only be used inside a Ticket channel created by the bot.')] });
            }
            const ticket = ticketRes.rows[0];

          
            if (subcommand === 'add') {
                const targetUser = options.getUser('user');
                let targetMember;
                try { targetMember = await guild.members.fetch(targetUser.id); } 
                catch (e) { return interaction.editReply({ embeds: [error(`User **${targetUser.tag}** is not in this server.`)] }); }

                await channel.permissionOverwrites.create(targetMember, {
                    ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true
                });
                return interaction.editReply({ embeds: [success(`**${targetMember.user.tag}** has been added to the ticket.`)] });
            }

          
            if (subcommand === 'remove') {
                const targetUser = options.getUser('user');
                if (targetUser.id === ticket.user_id) return interaction.editReply({ embeds: [error('You cannot remove the ticket owner.')] });
                
                if (!channel.permissionOverwrites.cache.has(targetUser.id)) {
                    return interaction.editReply({ embeds: [error(`**${targetUser.tag}** is not in this ticket.`)] });
                }

                await channel.permissionOverwrites.delete(targetUser);
                return interaction.editReply({ embeds: [success(`**${targetUser.tag}** has been removed from the ticket.`)] });
            }

          
            if (subcommand === 'rename') {
                const newName = options.getString('name');
                await channel.setName(newName);
                return interaction.editReply({ embeds: [success(`Ticket renamed to **${newName}**.`)] });
            }

            if (subcommand === 'claim') {
                await channel.permissionOverwrites.create(user, {
                    ViewChannel: true, SendMessages: true, ManageChannels: true, ManageMessages: true
                });
                await channel.setTopic(`Ticket Claimed by: ${user.tag}`);
                await interaction.deleteReply().catch(()=>{}); 
                return channel.send({ embeds: [new EmbedBuilder().setDescription(`🙋‍♂️ Ticket successfully **claimed** by <@${user.id}>.`).setColor('#F1C40F')] });
            }

            if (subcommand === 'close') {
                const reason = options.getString('reason') || 'No reason provided';

                let authorized = false;
                if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    authorized = true;
                } else if (ticket.panel_id) {
                    const panelRes = await db.query('SELECT support_role_id FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guild.id, ticket.panel_id]);
                    const supportRoleId = panelRes.rows[0]?.support_role_id;
                    if (supportRoleId && member.roles.cache.has(supportRoleId)) authorized = true;
                }

                if (!authorized) {
                    return interaction.editReply({ embeds: [error('⛔ **Access Denied:** Only members with the **Support Role** for this panel can close this ticket.')] });
                }

         
                await interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`🔒 **Closing ticket...** (Reason: ${reason})`).setColor('#E74C3C')] });

                try { await channel.setName(`closed-${ticket.id}`); } catch (e) {}
                
             
                let attachment;
                try {
                    attachment = await discordTranscripts.createTranscript(channel, {
                        limit: -1, returnType: 'attachment', filename: `transcript-${ticket.id}.html`, saveImages: true, poweredBy: false
                    });
                } catch (e) { console.error("[TICKET] Transcript error:", e); }

                let logChannelId = null;
                if (ticket.panel_id) {
                    const panelRes = await db.query('SELECT log_channel_id FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guild.id, ticket.panel_id]);
                    logChannelId = panelRes.rows[0]?.log_channel_id;
                }

                if (logChannelId) {
                    const logChannel = guild.channels.cache.get(logChannelId);
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('📕 Ticket Closed')
                            .setColor('#E74C3C')
                            .setDescription(`**Ticket ID:** \`${ticket.id}\`\n**Panel:** \`${ticket.panel_id || 'Unknown'}\``)
                            .addFields(
                                { name: '👤 Owner', value: `<@${ticket.user_id}>`, inline: true },
                                { name: '👮 Closed By', value: `<@${user.id}>`, inline: true },
                                { name: '📝 Reason', value: `\`${reason}\``, inline: false }
                            )
                            .setTimestamp();
                        
                        const payload = { embeds: [logEmbed] };
                        if (attachment) payload.files = [attachment];
                        await logChannel.send(payload).catch(e => console.error("[TICKET] Failed to send log:", e));
                    }
                }

                await db.query('DELETE FROM tickets WHERE channel_id = $1', [channel.id]);
                setTimeout(() => { channel.delete().catch(() => {}); }, 4000);
            }

        } catch (err) {
            console.error("[TICKET COMMAND ERROR]", err);
            if (!interaction.replied) await interaction.editReply({ embeds: [error(`Critical Error: ${err.message}`)] }).catch(()=>{});
        }
    }
};