const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { DEVELOPER_IDS } = require('../../utils/config');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('test_error')
        .setDescription('Error Testing')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        if (!DEVELOPER_IDS.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ Access Denied: Only the developer can use this command.', ephemeral: true });
        }

        await interaction.reply({ content: 'Provocando un ReferenceError.', ephemeral: true });

        variableNoDefinida.causarFallo();
    },
};