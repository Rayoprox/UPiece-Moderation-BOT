const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const antiNuke = require('../../utils/antiNuke.js');
const { success, error } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('backupload')
        .setDescription('Force load the last backup (requires double confirmation).'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Double Confirmation Required')
            .setDescription(
                `**WARNING: This will restore your entire server from backup!**\n\n` +
                `This action will:\n` +
                `• ${String.fromCharCode(10060)} Delete all NEW channels (not in backup)\n` +
                `• ${String.fromCharCode(10060)} Delete all NEW roles (not in backup)\n` +
                `• ${String.fromCharCode(10004)} Restore channels to backup state\n` +
                `• ${String.fromCharCode(10004)} Restore roles to backup state\n` +
                `• ${String.fromCharCode(10004)} Restore all permissions\n\n` +
                `**This action CANNOT be undone!**`
            )
            .setColor(0xDC2626)
            .setTimestamp();

        const confirmButton = new ButtonBuilder()
            .setCustomId(`backup_load_confirm_${interaction.guild.id}`)
            .setLabel('✅ Yes, Restore Now')
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId(`backup_load_cancel_${interaction.guild.id}`)
            .setLabel('❌ Cancel')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        const confirmEmbed = new EmbedBuilder()
            .setTitle('✅ Confirmation Received')
            .setDescription('Click the button below to confirm this action.')
            .setColor(0xFF9800);

        const confirmButton2 = new ButtonBuilder()
            .setCustomId(`backup_load_final_confirm_${interaction.guild.id}`)
            .setLabel('🔄 FINAL CONFIRM - Restore Server')
            .setStyle(ButtonStyle.Danger);

        const row2 = new ActionRowBuilder().addComponents(confirmButton2);

        // Guardar para el manejador de botones
        await interaction.editReply({ embeds: [embed], components: [row] });

        // Crear un collector para los botones
        const filter = (i) => i.user.id === interaction.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 5 * 60 * 1000 }); // 5 min

        collector.on('collect', async (buttonInteraction) => {
            if (buttonInteraction.customId === `backup_load_cancel_${interaction.guild.id}`) {
                await buttonInteraction.update({ 
                    embeds: [error('Restoration cancelled.')], 
                    components: [] 
                });
                collector.stop();
                return;
            }

            if (buttonInteraction.customId === `backup_load_confirm_${interaction.guild.id}`) {
                await buttonInteraction.update({ 
                    embeds: [confirmEmbed], 
                    components: [row2] 
                });
                return;
            }

            if (buttonInteraction.customId === `backup_load_final_confirm_${interaction.guild.id}`) {
                await buttonInteraction.deferUpdate();
                
                const loadingEmbed = new EmbedBuilder()
                    .setTitle('🔄 Restoring Server...')
                    .setDescription('Please wait while we restore your server from backup.')
                    .setColor(0x3B82F6);

                await interaction.editReply({ embeds: [loadingEmbed], components: [] });

                const result = await antiNuke.restoreGuild(interaction.guild);

                if (result === 'SUCCESS') {
                    const successEmbed = new EmbedBuilder()
                        .setTitle('✅ Server Restored Successfully')
                        .setDescription('Your server has been restored from the latest backup.')
                        .addFields(
                            { name: 'Status', value: 'All channels and roles restored', inline: false }
                        )
                        .setColor(0x10B981)
                        .setTimestamp();
                    
                    await interaction.editReply({ embeds: [successEmbed], components: [] });
                } else if (result === 'IN_PROGRESS') {
                    await interaction.editReply({ embeds: [error('A restoration is already in progress. Please wait.')] });
                } else if (result === 'NO_DATA') {
                    await interaction.editReply({ embeds: [error('No backup found to restore. Run `/backupsave` first.')] });
                } else if (result === 'FAILED_ALL_BACKUPS') {
                    await interaction.editReply({ embeds: [error('All available backups failed to restore. This may indicate corruption. Check console logs.')] });
                } else {
                    await interaction.editReply({ embeds: [error('Error during restoration. Check logs.')] });
                }

                collector.stop();
            }
        });

        collector.on('end', () => {
            // No hacer nada al expirar
        });
    },
};
