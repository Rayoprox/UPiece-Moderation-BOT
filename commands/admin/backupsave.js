const { SlashCommandBuilder } = require('discord.js');
const antiNuke = require('../../utils/antiNuke.js');
const { success, error } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('backupsave')
        .setDescription('Force save current server state (Overwrite backup).'),

    async execute(interaction) {
        const result = await antiNuke.createBackup(interaction.guild);
        
        if (result === 'SUCCESS') {
            await interaction.editReply({ embeds: [success('**Backup Saved!** Current server state has been securely stored.')] });
        } else if (result === 'IN_PROGRESS') {
            await interaction.editReply({ embeds: [error('A backup process is already running. Please wait.')] });
        } else {
            await interaction.editReply({ embeds: [error('Error saving backup. Please check console logs.')] });
        }
    },
};
