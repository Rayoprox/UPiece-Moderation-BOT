const { EmbedBuilder } = require('discord.js');
const discordTranscripts = require('discord-html-transcripts');
const { success, error } = require('../../utils/embedFactory.js');

async function handleTicketActions(interaction, client) {
    const { customId, channel, user, guild, member } = interaction;
    const db = client.db;

  
    const ticketRes = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channel.id]);
    
    if (ticketRes.rows.length === 0) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });
        return interaction.editReply({ embeds: [error('This ticket is not registered in the database.')] });
    }
    const ticket = ticketRes.rows[0];


    async function isAuthorizedStaff() {
        if (member.permissions.has('Administrator')) return true;
        if (!ticket.panel_id) return true; 

        const panelRes = await db.query('SELECT support_role_id FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guild.id, ticket.panel_id]);
        const supportRoleId = panelRes.rows[0]?.support_role_id;

        if (supportRoleId && !member.roles.cache.has(supportRoleId)) return false;
        return true;
    }

    // ======================
    //  ACTION: CLOSE TICKET
    // ========================
    if (customId === 'ticket_action_close') {
        await interaction.deferReply({ ephemeral: true });

        if (!await isAuthorizedStaff()) {
            return interaction.editReply({ embeds: [error('⛔ **Access Denied:** Only Support Staff can close this ticket.')] });
        }

        await interaction.editReply({ embeds: [new EmbedBuilder().setDescription('🔒 **Closing Ticket...** Generating transcript.').setColor('#E74C3C')] });

        try { await channel.setName(`closed-${ticket.id}`); } catch(e){}

        let attachment;
        try {
            attachment = await discordTranscripts.createTranscript(channel, {
                limit: -1, returnType: 'attachment', filename: `transcript-${ticket.id}.html`, saveImages: true, poweredBy: false
            });
        } catch(e) { console.error(e); }

        // LOGGING 
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
                        { name: '📝 Reason', value: '`Button Click`', inline: false }
                    )
                    .setTimestamp();
                
                const payload = { embeds: [logEmbed] };
                if (attachment) payload.files = [attachment];
                await logChannel.send(payload).catch(e => console.error("[TICKET] Failed to send log:", e));
            }
        }

        await db.query('DELETE FROM tickets WHERE channel_id = $1', [channel.id]);
        setTimeout(() => { channel.delete().catch(() => {}); }, 3000);
    }

    // =====================
    // ACTION: CLAIM TICKET
    // ======================
    if (customId === 'ticket_action_claim') {
        await interaction.deferReply({ ephemeral: false });

        if (!await isAuthorizedStaff()) {
            await interaction.deleteReply();
            return interaction.followUp({ embeds: [error('⛔ Only Support Staff can claim tickets.')], ephemeral: true });
        }

        const claimEmbed = new EmbedBuilder().setDescription(`🙋‍♂️ **Ticket Claimed** by <@${user.id}>`).setColor('#F1C40F');

        await channel.setTopic(`Ticket managed by: ${user.tag}`).catch(() => {});
        await channel.permissionOverwrites.edit(user, { ManageMessages: true, ManageChannels: true });

        await interaction.editReply({ embeds: [claimEmbed] });
    }
}

module.exports = { handleTicketActions };