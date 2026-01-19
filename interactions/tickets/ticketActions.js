const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    PermissionsBitField,
    MessageFlags 
} = require('discord.js');
const discordTranscripts = require('discord-html-transcripts');
const { error, success } = require('../../utils/embedFactory.js');
const { smartReply } = require('../../utils/interactionHelpers.js');
const db = require('../../utils/db.js');

async function closeTicket(interaction, client, reason = 'No reason provided') {
    const { channel, guild, user } = interaction;

    const ticketRes = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channel.id]);
    if (ticketRes.rows.length === 0) return channel.delete().catch(() => {});
    const ticketData = ticketRes.rows[0];

    const panelRes = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guild.id, ticketData.panel_id]);
    const panelData = panelRes.rows[0];

    try {
        const transcript = await discordTranscripts.createTranscript(channel, {
            limit: -1,
            returnType: 'attachment',
            filename: `transcript-${channel.name}.html`,
            saveImages: true,
            poweredBy: false
        });

        if (panelData && panelData.log_channel_id) {
            const logChannel = guild.channels.cache.get(panelData.log_channel_id);
            if (logChannel) {
                const closeTime = Date.now();
                const duration = Math.floor((closeTime - Number(ticketData.created_at)) / 1000);
                const hours = Math.floor(duration / 3600);
                const minutes = Math.floor((duration % 3600) / 60);

                const logEmbed = new EmbedBuilder()
                    .setTitle('🎫 Ticket Closed & Archived')
                    .setColor('#FF4B4B')
                    .setThumbnail(user.displayAvatarURL())
                    .addFields(
                        { name: 'Author', value: `<@${ticketData.user_id}>`, inline: true },
                        { name: 'Closed By', value: `<@${user.id}>`, inline: true },
                        { name: 'Panel', value: `\`${panelData.title}\``, inline: true },
                        { name: 'Reason', value: `\`${reason}\``, inline: false },
                        { name: 'Opened At', value: `<t:${Math.floor(Number(ticketData.created_at) / 1000)}:f>`, inline: false },
                        { name: 'Closed At', value: `<t:${Math.floor(closeTime / 1000)}:f>`, inline: false },
                        { name: 'Duration', value: `\`${hours}h ${minutes}m\``, inline: true }
                    )
                    .setFooter({ text: `Ticket ID: ${channel.id} • Made by: ukirama` })
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed], files: [transcript] });
            }
        }

        await db.query("UPDATE tickets SET status = 'CLOSED', closed_at = $1, closed_by = $2, close_reason = $3 WHERE channel_id = $4", [Date.now(), user.id, reason, channel.id]);
        
        setTimeout(() => {
            channel.delete().catch(() => {});
        }, 2000);

    } catch (err) {
        console.error(err);
        channel.delete().catch(() => {});
    }
}

async function claimTicket(interaction, client) {
    const { channel, user, guild, message } = interaction;

    const ticketRes = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channel.id]);
    const ticketData = ticketRes.rows[0];

    const panelRes = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guild.id, ticketData.panel_id]);
    const panelData = panelRes.rows[0];

    const supportRoleId = panelData?.support_role_id;

    await db.query('UPDATE tickets SET participants = $1 WHERE channel_id = $2', [user.id, channel.id]);

    if (supportRoleId && guild.roles.cache.has(supportRoleId)) {
        await channel.permissionOverwrites.edit(supportRoleId, { SendMessages: false });
    }
    await channel.permissionOverwrites.edit(user.id, { SendMessages: true, ViewChannel: true });

    const rows = message.components.map(oldRow => {
        const row = ActionRowBuilder.from(oldRow);
        row.components.forEach(c => {
            if (c.data.custom_id === 'ticket_action_claim') {
                c.setCustomId('ticket_action_unclaim')
                 .setLabel('Unclaim Ticket')
                 .setStyle(ButtonStyle.Danger)
                 .setEmoji('🔓');
            }
        });
        return row;
    });

    await interaction.update({ components: rows });
    await channel.send({ embeds: [success(`${user} has **claimed** this ticket. Support staff is now in read-only mode.`)] });
}

async function unclaimTicket(interaction, client) {
    const { channel, user, guild, message } = interaction;

    const ticketRes = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channel.id]);
    const ticketData = ticketRes.rows[0];

    if (ticketData.participants !== user.id && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return await smartReply(interaction, { embeds: [error('You are not the person who claimed this ticket.')] }, true);
    }

    const panelRes = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guild.id, ticketData.panel_id]);
    const panelData = panelRes.rows[0];

    const supportRoleId = panelData?.support_role_id;

    await db.query('UPDATE tickets SET participants = NULL WHERE channel_id = $1', [channel.id]);

    if (supportRoleId && guild.roles.cache.has(supportRoleId)) {
        await channel.permissionOverwrites.edit(supportRoleId, { SendMessages: true });
    }

    const rows = message.components.map(oldRow => {
        const row = ActionRowBuilder.from(oldRow);
        row.components.forEach(c => {
            if (c.data.custom_id === 'ticket_action_unclaim') {
                c.setCustomId('ticket_action_claim')
                 .setLabel('Claim Ticket')
                 .setStyle(ButtonStyle.Secondary)
                 .setEmoji('🙋‍♂️');
            }
        });
        return row;
    });

    await interaction.update({ components: rows });
    await channel.send({ embeds: [success(`Ticket **unclaimed**. All support staff can speak again.`)] });
}

async function handleTicketActions(interaction, client) {
    const { customId } = interaction;

    if (customId === 'ticket_action_close') {
        const modal = new ModalBuilder().setCustomId('ticket_close_modal').setTitle('Close Ticket');
        const reasonInput = new TextInputBuilder().setCustomId('close_reason').setLabel("Reason").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200);
        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        return await interaction.showModal(modal);
    }

    if (customId === 'ticket_close_modal') {
        const reason = interaction.fields.getTextInputValue('close_reason') || 'No reason provided';
        
        await interaction.reply({ 
            embeds: [success('Closing ticket and generating transcript...').setFooter({ text: 'Made by: ukirama' })],
            flags: MessageFlags.Ephemeral 
        });

        return await closeTicket(interaction, client, reason);
    }

    if (customId === 'ticket_action_claim') {
        return await claimTicket(interaction, client);
    }

    if (customId === 'ticket_action_unclaim') {
        return await unclaimTicket(interaction, client);
    }
}

module.exports = { handleTicketActions, closeTicket, claimTicket, unclaimTicket };