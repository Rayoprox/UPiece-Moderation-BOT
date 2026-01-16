const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('test_error')
        .setDescription('Fuerza un error de código para probar el Webhook de Logs.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        if (interaction.user.id !== '715926664344895559') {
            return interaction.reply({ content: '❌ Access Denied: Only the developer can use this command.', ephemeral: true });
        }

        await interaction.reply({ content: 'Provocando un ReferenceError.', ephemeral: true });

        variableNoDefinida.causarFallo();
    },
};