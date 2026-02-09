const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { closeTicket, claimTicket, unclaimTicket } = require('../../interactions/tickets/ticketActions.js');
const { success, error } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main', 
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Manage support tickets.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addSubcommand(sub => sub.setName('claim').setDescription('Claim this ticket as yours.'))
        .addSubcommand(sub => sub.setName('unclaim').setDescription('Release this ticket.'))
        .addSubcommand(sub => sub.setName('close').setDescription('Close this ticket.').addStringOption(opt => opt.setName('reason').setDescription('Reason for closing').setRequired(false)))
        .addSubcommand(sub => sub.setName('add').setDescription('Add user to ticket').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove user from ticket').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))),

    async execute(interaction) {
        const { options, client, channel, member, guild } = interaction;
        const subcommand = options.getSubcommand();
        const db = client.db;

        const ticketRes = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channel.id]);
        if (ticketRes.rows.length === 0) return await interaction.editReply({ embeds: [error('This command can only be used inside a ticket channel.')] });
        
        if (subcommand === 'claim') {
            await claimTicket(interaction, client, db);
        } 
        else if (subcommand === 'unclaim') {
            await unclaimTicket(interaction, client, db);
        } 
        else if (subcommand === 'close') {
            const reason = options.getString('reason') || 'Command forced close';
            await closeTicket(interaction, client, db, reason);
        }
        
        else if (subcommand === 'add') {
            const target = options.getUser('user');
            await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true });
            await interaction.editReply({ embeds: [success(`Added ${target} to the ticket.`)] });
        }
        else if (subcommand === 'remove') {
            const target = options.getUser('user');
            await channel.permissionOverwrites.delete(target.id);
            await interaction.editReply({ embeds: [success(`Removed ${target} from the ticket.`)] });
        }
    }
};
