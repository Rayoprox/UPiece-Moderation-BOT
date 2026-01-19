const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { closeTicket, claimTicket, unclaimTicket } = require('../../interactions/tickets/ticketActions.js');
const { success, error } = require('../../utils/embedFactory.js');
const db = require('../../utils/db.js');

module.exports = {
    deploy: 'main', 
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Manage support tickets.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addSubcommand(sub => sub.setName('claim').setDescription('Claim this ticket.'))
        .addSubcommand(sub => sub.setName('unclaim').setDescription('Unclaim this ticket.'))
        .addSubcommand(sub => sub.setName('close').setDescription('Close this ticket.').addStringOption(opt => opt.setName('reason').setDescription('Reason'))),

    async execute(interaction) {
        const { options, channel, member } = interaction;
        const subcommand = options.getSubcommand();

        const ticketRes = await db.query('SELECT * FROM tickets WHERE channel_id = $1', [channel.id]);
        if (ticketRes.rows.length === 0) return interaction.reply({ embeds: [error('This is not a ticket channel.')], ephemeral: true });

        if (subcommand === 'claim') {
            await claimTicket(interaction, interaction.client);
        }

        if (subcommand === 'unclaim') {
            await unclaimTicket(interaction, interaction.client);
        }

        if (subcommand === 'close') {
            const reason = options.getString('reason') || 'No reason provided';
            await closeTicket(interaction, interaction.client, reason);
        }
    }
};