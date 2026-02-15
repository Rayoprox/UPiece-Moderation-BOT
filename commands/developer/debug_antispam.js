const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../utils/db.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('debug_antispam')
        .setDescription('🧪 Debug Anti-Spam configuration and test detections')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Admin only', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const guildId = interaction.guild.id;

        try {
            const res = await db.query('SELECT antispam FROM automod_protections WHERE guildid = $1', [guildId]);
            const antispam = res.rows[0]?.antispam || {};

            const embed = new EmbedBuilder()
                .setTitle('🧪 Anti-Spam Debug Information')
                .setColor('#3B82F6')
                .setDescription('Current Anti-Spam Configuration for this guild');

            // MPS Config
            const mpsConfig = antispam.mps || { threshold: 0, enabled: false, bypass: [], window_seconds: 1 };
            embed.addFields({
                name: '📨 Messages Per Second (MPS)',
                value: `
**Status**: ${mpsConfig.enabled ? '✅ ENABLED' : '❌ DISABLED'}
**Threshold**: ${mpsConfig.threshold || 'Not set'} msgs
**Window**: ${mpsConfig.window_seconds || 1} second(s)
**Bypass Roles**: ${mpsConfig.bypass?.length ? `${mpsConfig.bypass.length} role(s)` : 'None'}
                `.trim(),
                inline: false
            });

            // Repeated Char Config
            const repeatedConfig = antispam.repeated || { threshold: 0, enabled: false, bypass: [] };
            embed.addFields({
                name: '🔁 Repeated Characters',
                value: `
**Status**: ${repeatedConfig.enabled ? '✅ ENABLED' : '❌ DISABLED'}
**Threshold**: ${repeatedConfig.threshold || 'Not set'} characters minimum
**Bypass Roles**: ${repeatedConfig.bypass?.length ? `${repeatedConfig.bypass.length} role(s)` : 'None'}
                `.trim(),
                inline: false
            });

            // Emoji Config
            const emojiConfig = antispam.emoji || { threshold: 0, enabled: false, bypass: [] };
            embed.addFields({
                name: '😀 Emoji Spam',
                value: `
**Status**: ${emojiConfig.enabled ? '✅ ENABLED' : '❌ DISABLED'}
**Threshold**: ${emojiConfig.threshold || 'Not set'} emojis minimum
**Bypass Roles**: ${emojiConfig.bypass?.length ? `${emojiConfig.bypass.length} role(s)` : 'None'}
                `.trim(),
                inline: false
            });

            embed.addFields({
                name: '📝 Test Commands',
                value: `
\`\`\`
To test MPS: Send ${(mpsConfig.threshold || 5) + 1} messages rapidly
To test Repeated: Send "${repeatedConfig.threshold ? 'A'.repeat(repeatedConfig.threshold) : 'AAAAA'}"
To test Emoji: Send ${(emojiConfig.threshold || 3) + 1} emojis
\`\`\`
                `.trim(),
                inline: false
            });

            embed.setFooter({ text: 'All detections will show type-specific enforcement messages' });

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('[debug_antispam] Error:', err);
            await interaction.editReply({ 
                embeds: [new EmbedBuilder().setDescription('❌ Error fetching Anti-Spam config').setColor('#EF4444')] 
            });
        }
    }
};
