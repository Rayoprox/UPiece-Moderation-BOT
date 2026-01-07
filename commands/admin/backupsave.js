const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const antiNuke = require('../../utils/antiNuke.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('backupsave')
        .setDescription('Force save current server state (Overwrite backup).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        // La interacción YA está deferida por el handler principal, así que usamos editReply directamente.
        
        const result = await antiNuke.createBackup(interaction.guild);
        
        if (result === 'SUCCESS') {
            await interaction.editReply('✅ **Backup Saved!** Current server state has been securely stored.');
        } else if (result === 'IN_PROGRESS') {
            await interaction.editReply('⚠️ A backup process is already running. Please wait.');
        } else {
            await interaction.editReply('❌ Error saving backup. Please check the console logs.');
        }
    },
};