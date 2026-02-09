const { SlashCommandBuilder } = require('discord.js');
const antiNuke = require('../../utils/antiNuke.js');
const { success, error } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('backupload')
        .setDescription('Force load the last backup (WARNING: STRICT RESTORE).'),

    async execute(interaction) {
        const result = await antiNuke.restoreGuild(interaction.guild);
        
        if (result === 'SUCCESS') {
            await interaction.editReply({ embeds: [success('**Server Restored.** Cleanup and reconstruction complete.')] });
        } else if (result === 'IN_PROGRESS') {
            await interaction.editReply({ embeds: [error('A restoration is already in progress. Please wait.')] });
        } else if (result === 'NO_DATA') {
            await interaction.editReply({ embeds: [error('No backup found to restore. Run `/backupsave` first.')] });
        } else {
            await interaction.editReply({ embeds: [error('Error during restoration. Check logs.')] });
        }
    },
};
