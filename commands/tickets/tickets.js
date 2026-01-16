const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { closeTicket, claimTicket } = require('../../interactions/tickets/ticketActions.js');
const { success, error } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main', 
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Manage support tickets.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addSubcommand(sub => sub.setName('add').setDescription('Add a user to this ticket.').addUserOption(opt => opt.setName('user').setDescription('User to add').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a user from this ticket.').addUserOption(opt => opt.setName('user').setDescription('User to remove').setRequired(true)))
        .addSubcommand(sub => sub.setName('rename').setDescription('Rename this ticket.').addStringOption(opt => opt.setName('name').setDescription('New name').setRequired(true)))
        .addSubcommand(sub => sub.setName('claim').setDescription('Claim this ticket as yours.'))
        .addSubcommand(sub => sub.setName('close').setDescription('Force close this ticket.').addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(false))),

    async execute(interaction) {
        try {
            const { options, channel, guild, client, member } = interaction;
            const subcommand = options.getSubcommand();

           
            const isPublicAction = ['close', 'claim'].includes(subcommand);
            
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: !isPublicAction });
            }

            
            const db = client.db;
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
                await claimTicket(interaction, client, db);
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
                    return interaction.editReply({ embeds: [error('⛔ **Access Denied:** Only members with the **Support Role** can close this ticket.')] });
                }

                await closeTicket(interaction, client, db, reason);
            }

        } catch (err) {
            console.error("[TICKET COMMAND ERROR]", err);
            
            if (!interaction.replied) await interaction.editReply({ embeds: [error(`Critical Error: ${err.message}`)] }).catch(()=>{});
        }
    }
};