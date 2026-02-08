const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, MessageFlags } = require('discord.js');
const { error, success } = require('../../utils/embedFactory.js');
const { smartReply } = require('../../utils/interactionHelpers.js');
const db = require('../../utils/db.js');

async function handleTicketOpen(interaction, client) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { customId, user, guild } = interaction;
    const panelId = customId.replace('ticket_open_', '');
    
    const res = await db.query('SELECT * FROM ticket_panels WHERE guild_id = $1 AND panel_id = $2', [guild.id, panelId]);
    if (res.rows.length === 0) return await smartReply(interaction, { embeds: [error('Panel not found.')] });
    const panel = res.rows[0];

    const ticketLimit = panel.ticket_limit || 1; 

    
    const activeTicketsRes = await db.query(
        "SELECT channel_id FROM tickets WHERE user_id = $1 AND panel_id = $2 AND status = 'OPEN'", 
        [user.id, panelId]
    );

    const openTicketsCount = activeTicketsRes.rows.filter(row => guild.channels.cache.get(row.channel_id)).length;

    if (openTicketsCount >= ticketLimit) {
        return await smartReply(interaction, { 
            embeds: [error(` **Limit Reached:** You can only have **${ticketLimit}** open ticket(s) in this panel category.\n\nPlease close your existing ticket before opening a new one.`)] 
        }, true);
    }


    try {
        const ticketChannel = await guild.channels.create({
            name: `ticket-${user.username.slice(0, 10)}`,
            type: ChannelType.GuildText,
            parent: panel.ticket_category_id || null,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { 
                    id: user.id, 
                    allow: [
                        PermissionsBitField.Flags.ViewChannel, 
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.AttachFiles, 
                        PermissionsBitField.Flags.EmbedLinks  
                    ] 
                },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels] }
            ]
        });

        if (panel.support_role_id) await ticketChannel.permissionOverwrites.edit(panel.support_role_id, { ViewChannel: true, SendMessages: true });

        const welcomeEmbed = new EmbedBuilder()
            .setTitle(panel.title)
            .setDescription(panel.welcome_message.replace('{user}', `<@${user.id}>`))
            .setColor(0x5865F2)
            .setFooter({ text: 'Made by Ukirama' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_action_close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
            new ButtonBuilder().setCustomId('ticket_action_claim').setLabel('Claim').setStyle(ButtonStyle.Secondary).setEmoji('🙋‍♂️')
        );

        await ticketChannel.send({ content: panel.support_role_id ? `<@&${panel.support_role_id}>` : null, embeds: [welcomeEmbed], components: [row] });
        
        await db.query(
            `INSERT INTO tickets (guild_id, channel_id, user_id, panel_id, status, created_at) VALUES ($1, $2, $3, $4, 'OPEN', $5)`, 
            [guild.id, ticketChannel.id, user.id, panelId, Date.now()]
        );
        
        await smartReply(interaction, { embeds: [success(`Ticket opened: ${ticketChannel}`)] });
    } catch (err) {
        console.error(err);
        await smartReply(interaction, { embeds: [error('Failed to create ticket.')] });
    }
}

module.exports = { handleTicketOpen };