
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../utils/db.js');
const { SUPREME_IDS, emojis } = require('../../utils/config.js');

module.exports = {
    deploy: 'main', 
    data: new SlashCommandBuilder()
        .setName('universalpanel')
        .setDescription('👑 Advanced Control Panel (Restricted Access).'),

    async execute(interaction) {
        // 1. Verificación de Seguridad (Solo SUPREME IDs)
        if (!SUPREME_IDS.includes(interaction.user.id)) {
            // Usamos editReply porque interactionCreate.js ya hizo deferReply
            return interaction.editReply({ 
                content: `${emojis.error} **ACCESS DENIED.** You are not authorized to use this panel.`
            });
        }

        const guildId = interaction.guild.id;

        // 2. Obtener estado actual del bloqueo
        const res = await db.query('SELECT universal_lock FROM guild_settings WHERE guildid = $1', [guildId]);
        let isLocked = res.rows[0]?.universal_lock || false;

        // 3. Crear Embed
        const embed = new EmbedBuilder()
            .setTitle('👑 Management Control Panel')
            .setDescription(`Control the absolute permission state of the bot.\n\n**Current State:** ${isLocked ? `${emojis.lock} **RESTRICTED (Lockdown)**` : `${emojis.unlock} **DEFAULT (Standard)**`}`)
            .addFields(
                { name: `${emojis.unlock} Default YES`, value: 'Admins have full access. `/setup` works normally.' },
                { name: `${emojis.lock} Default NO`, value: 'Strict Mode. Admins have **NO** access unless explicitly whitelisted.' }
            )
            .setColor(isLocked ? 0xFF0000 : 0x00FF00);

        // 4. Crear Botones
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('univ_toggle_lock')
                .setLabel(isLocked ? 'Switch to: Unlock' : 'Switch to: Lockdown')
                .setEmoji(isLocked ? (emojis.unlock || '🔓') : (emojis.lock || '🔒'))
                .setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('univ_edit_perms')
                .setLabel('Edit Permissions')
                .setStyle(ButtonStyle.Primary)
        );

        // 5. Enviar respuesta
        // CAMBIO CRÍTICO: editReply en lugar de reply
        await interaction.editReply({ 
            embeds: [embed], 
            components: [row1]
        });
    }
};
