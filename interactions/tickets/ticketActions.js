const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const discordTranscripts = require('discord-html-transcripts');
const { error, success } = require('../../utils/embedFactory.js');

async function closeTicket(interaction, client, db, reason = 'No reason provided') {
    const { channel, guild, user } = interaction;

    if (!interaction.deferred && !interaction.replied) {
        if (interaction.isChatInputCommand()) await interaction.deferReply({ ephemeral: false });
        else await interaction.deferUpdate();
    }

    const ticketRes = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channel.id]);
    if (ticketRes.rows.length === 0) return channel.delete().catch(() => {});
    const ticket = ticketRes.rows[0];

    try {
        const ticketOwner = await guild.members.fetch(ticket.user_id).catch(() => null);
        if (ticketOwner) {
            await channel.permissionOverwrites.edit(ticketOwner, { ViewChannel: false, SendMessages: false });
        }
    } catch (e) {}

    await channel.send({ 
        embeds: [new EmbedBuilder()
            .setDescription(`🔒 **Ticket Closed.**\n**Reason:** ${reason}\n\n*Generating transcript...*`)
            .setColor('#F1C40F') 
        ]
    });

    await db.query(`UPDATE tickets SET status = 'CLOSED', closed_at = $1, closed_by = $2, close_reason = $3 WHERE channel_id = $4`, [Date.now(), user.id, reason, channel.id]);

    let attachment = null;
    try {
        attachment = await discordTranscripts.createTranscript(channel, {
            limit: -1, returnType: 'attachment', filename: `ticket-${ticket.panel_id}-${ticket.user_id}.html`, saveImages: true, poweredBy: false
        });
    } catch (err) {
        await channel.send({ embeds: [error("Failed to generate transcript.")] });
    }

    try {
        const panelRes = await db.query('SELECT log_channel_id FROM ticket_panels WHERE panel_id = $1', [ticket.panel_id]);
        let logChannelId = panelRes.rows[0]?.log_channel_id;

        if (!logChannelId) {
            const generalLog = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [guild.id, 'modlog']);
            logChannelId = generalLog.rows[0]?.channel_id;
        }

        if (logChannelId) {
            const logChannel = guild.channels.cache.get(logChannelId);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('📕 Ticket Closed')
                    .addFields(
                        { name: 'Owner', value: `<@${ticket.user_id}>`, inline: true },
                        { name: 'Closed By', value: `<@${user.id}>`, inline: true },
                        { name: 'Reason', value: `\`${reason}\``, inline: false },
                        { name: 'Duration', value: `<t:${Math.floor(Number(ticket.created_at) / 1000)}:R>`, inline: true }
                    )
                    .setColor('#E74C3C')
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed], files: attachment ? [attachment] : [] });
            }
        }
    } catch (err) {}

    await channel.delete().catch(() => {});
}

async function claimTicket(interaction, client, db) {
    if (!interaction.deferred && !interaction.replied) {
        if (interaction.isChatInputCommand()) await interaction.deferReply({ ephemeral: false });
        else await interaction.deferUpdate();
    }
    
    const { channel, user, guild } = interaction;
    
    const check = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channel.id]);
    if (check.rows.length === 0) return;
    const ticket = check.rows[0];

    let supportRoleId = null;
    if (ticket.panel_id) {
        const panelRes = await db.query('SELECT support_role_id FROM ticket_panels WHERE panel_id = $1', [ticket.panel_id]);
        supportRoleId = panelRes.rows[0]?.support_role_id;
    }

    await channel.permissionOverwrites.edit(user, {
        ViewChannel: true, SendMessages: true, ManageChannels: true, ManageMessages: true, AttachFiles: true
    });

    if (supportRoleId) {
        const supportRole = guild.roles.cache.get(supportRoleId);
        if (supportRole) {
            await channel.permissionOverwrites.edit(supportRole, { ViewChannel: true, SendMessages: false });
        }
    }

    if (interaction.isButton()) {
        try {
            const currentComponents = interaction.message.components;
            const newComponents = currentComponents.map(row => {
                const newRow = ActionRowBuilder.from(row);
                newRow.setComponents(row.components.map(component => {
                    const newButton = ButtonBuilder.from(component);
                    if (newButton.data.custom_id === interaction.customId) {
                        newButton.setDisabled(true);
                        newButton.setLabel(`Claimed by ${user.username}`);
                        newButton.setStyle(ButtonStyle.Secondary);
                    }
                    return newButton;
                }));
                return newRow;
            });
            await interaction.message.edit({ components: newComponents });
        } catch (err) {}
    }

    const msg = { embeds: [success(`Ticket successfully **claimed** by <@${user.id}>.\nOnly they can speak now.`)] };

    if (interaction.isChatInputCommand()) await interaction.editReply(msg);
    else await channel.send(msg);
}

async function handleTicketActions(interaction, client) {
    const { customId } = interaction;
    const db = client.db;

    if (customId.startsWith('ticket_close_') || customId === 'ticket_action_close') {
        await closeTicket(interaction, client, db, 'Closed by Button');
    }
    else if (customId.startsWith('ticket_claim_') || customId === 'ticket_action_claim') {
        await claimTicket(interaction, client, db);
    }
}

module.exports = { handleTicketActions, closeTicket, claimTicket };