const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const { emojis } = require('../../utils/config.js');

const PURGE_COLOR = 0x3498DB; 
const ERROR_COLOR = 0xE74C3C; 
const SUCCESS_COLOR = 0x2ECC71; 

module.exports = {
    deploy: 'main',
    isPublic: true, 
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Deletes a specified number of messages from the channel (Max 100).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('The number of messages to delete (between 1 and 100).')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)),

    async execute(interaction) {
        const amount = interaction.options.getInteger('amount');
        const channel = interaction.channel;
        const moderatorTag = interaction.user.tag;
        
        if (!channel.permissionsFor(interaction.client.user).has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.editReply({ 
                content: `${emojis.error} I do not have the **Manage Messages** permission in this channel.`, 
                flags: [MessageFlags.Ephemeral] 
            });
        }
        
        let deletedCount = 0;
        
        try {
            const messages = await channel.messages.fetch({ limit: amount });
            const result = await channel.bulkDelete(messages, true);
            deletedCount = result.size;

        } catch (error) {
            console.error('[ERROR] Failed to execute purge:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor(ERROR_COLOR)
                .setTitle(`${emojis.error} Purge Operation Failed`)
                .setDescription('An unexpected error occurred during message deletion.')
                .addFields(
                    { name: 'Attempted Amount', value: `${amount}`, inline: true },
                    { name: `${emojis.channel} Channel`, value: `<#${channel.id}>`, inline: true }
                )
                .setFooter({ text: `Moderator: ${moderatorTag}` })
                .setTimestamp();

            return interaction.editReply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
        }
        
        const successEmbed = new EmbedBuilder()
            .setColor(deletedCount < amount ? PURGE_COLOR : SUCCESS_COLOR)
            .setTitle(`${emojis.success} Message Purge Complete`)
            .setDescription(`**${deletedCount}** message(s) deleted in <#${channel.id}>.`)
            .addFields(
                { name: 'Total Requested', value: `${amount}`, inline: true },
                { name: `${emojis.moderator} Moderator`, value: moderatorTag, inline: true }
            );

        let content = null;
        if (deletedCount < amount) {
            content = `${emojis.warn} **Note:** ${amount - deletedCount} message(s) could not be deleted because they are older than 14 days.`;
        }
        
        // Bloque de solución para evitar el error 'Unknown Message' (10008)
        try {
            // 1. Intentar editar la respuesta de la interacción.
            await interaction.editReply({ 
                content: content,
                embeds: [successEmbed]
            });
            
            // 2. Si es exitoso, programar la auto-eliminación después de 5 segundos.
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000); 
        } catch (error) {
            // 3. Manejar el error 10008 de forma sutil.
            if (error.code === 10008) {
                 // Advertencia sutil: La operación fue exitosa, solo falló la limpieza final de la respuesta.
                 console.warn(`[WARN] Final purge reply expired or was deleted before successful edit/delete for interaction ${interaction.id}. (Code: 10008)`);
            } else {
                 // Registrar otros errores inesperados.
                 console.warn('[WARN] Failed to edit or delete the final purge interaction reply:', error);
            }
        }
    },
};