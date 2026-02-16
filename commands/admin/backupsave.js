const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const antiNuke = require('../../utils/antiNuke.js');
const { success, error } = require('../../utils/embedFactory.js');
const crypto = require('crypto');

// Almacenar tokens de preview (guildId -> token)
const backupTokens = new Map();

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('backupsave')
        .setDescription('Force save current server state (Overwrite backup).'),

    async execute(interaction) {
        const result = await antiNuke.createBackup(interaction.guild);
        
        if (result === 'SUCCESS') {
            // Generar token único para preview
            const token = crypto.randomBytes(16).toString('hex');
            backupTokens.set(interaction.guild.id, {
                token,
                createdAt: Date.now(),
                expiresIn: 24 * 60 * 60 * 1000 // 24 horas
            });

            // Construir URL del preview
            const previewUrl = `${process.env.WEB_URL || 'http://localhost:3000'}/backup-preview/${interaction.guild.id}/${token}`;

            const embed = new EmbedBuilder()
                .setTitle('✅ Backup Saved Successfully!')
                .setDescription('Current server state has been securely stored.')
                .addFields(
                    { 
                        name: '📊 Preview Your Backup', 
                        value: `[Click here to view backup preview](${previewUrl})`, 
                        inline: false 
                    },
                    { 
                        name: '⏰ Token Expires In', 
                        value: '24 hours', 
                        inline: true 
                    },
                    { 
                        name: '🔒 Security', 
                        value: 'Only admins with access can view', 
                        inline: true 
                    }
                )
                .setColor(0x10B981)
                .setTimestamp();

            const viewButton = new ButtonBuilder()
                .setLabel('View Backup Preview')
                .setStyle(ButtonStyle.Link)
                .setURL(previewUrl);

            const row = new ActionRowBuilder().addComponents(viewButton);

            await interaction.editReply({ embeds: [embed], components: [row] });
        } else if (result === 'IN_PROGRESS') {
            await interaction.editReply({ embeds: [error('A backup process is already running. Please wait.')] });
        } else {
            await interaction.editReply({ embeds: [error('Error saving backup. Please check console logs.')] });
        }
    },
    
    // Para obtener el token (usado por web.js)
    getBackupToken(guildId) {
        const tokenData = backupTokens.get(guildId);
        if (!tokenData) return null;
        
        // Verificar que no ha expirado
        if (Date.now() - tokenData.createdAt > tokenData.expiresIn) {
            backupTokens.delete(guildId);
            return null;
        }
        
        return tokenData.token;
    },

    // Limpiar tokens expirados cada 1 hora
    startTokenCleanup() {
        setInterval(() => {
            let expired = 0;
            for (const [guildId, tokenData] of backupTokens.entries()) {
                if (Date.now() - tokenData.createdAt > tokenData.expiresIn) {
                    backupTokens.delete(guildId);
                    expired++;
                }
            }
            if (expired > 0) console.log(`[BACKUP] Cleaned up ${expired} expired tokens`);
        }, 60 * 60 * 1000); // Cada hora
    }
};
