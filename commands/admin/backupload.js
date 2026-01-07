const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const antiNuke = require('../../utils/antiNuke.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('backupload')
        .setDescription('Force load the last backup (WARNING: STRICT RESTORE).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        // Usamos editReply para evitar "InteractionAlreadyReplied"
        
        const result = await antiNuke.restoreGuild(interaction.guild);
        
        if (result === 'SUCCESS') {
            await interaction.editReply('✅ **Server Restored.** Cleanup and reconstruction complete.');
        } else if (result === 'IN_PROGRESS') {
            await interaction.editReply('⚠️ A restoration is already in progress. Please wait.');
        } else if (result === 'NO_DATA') {
            await interaction.editReply('❌ No backup found to restore. Run `/backupsave` first.');
        } else {
            await interaction.editReply('❌ Error during restoration. Check logs.');
        }
    },
};