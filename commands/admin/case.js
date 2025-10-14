const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('../../node_modules/discord.js');
const db = require('../../utils/db.js');
const { emojis } = require('../../utils/config.js');

module.exports = {
    deploy: 'main', 
    isPublic: true, 
    data: new SlashCommandBuilder()
        .setName('case')
        .setDescription('Displays details about a specific moderation case ID.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers) 
        .addStringOption(option =>
            option.setName('case_id')
                .setDescription('The Case ID of the log to view (e.g., CASE-12345).')
                .setRequired(true)),

    async execute(interaction) {
        
        
        const caseId = interaction.options.getString('case_id').trim();
        const guildId = interaction.guild.id;

      
        const logResult = await db.query('SELECT * FROM modlogs WHERE caseid = $1 AND guildid = $2', [caseId, guildId]);
        const log = logResult.rows[0];

        if (!log) {
          
            return interaction.editReply({ content: `${emojis.error} Case ID \`${caseId}\` not found in the logs for this server.`, flags: [MessageFlags.Ephemeral] });
        }

  
        const timestamp = Math.floor(Number(log.timestamp) / 1000);
        const action = log.action.charAt(0).toUpperCase() + log.action.slice(1).toLowerCase();
        
        let color = 0x3498DB; 
        if (log.action === 'WARN') color = 0xFFA500;
        else if (log.action === 'TIMEOUT' || log.action === 'MUTE') color = 0xFFA500;
        else if (log.action === 'BAN') color = 0xAA0000;
        else if (log.action === 'KICK') color = 0xE67E22;
        else if (log.status === 'VOIDED' || log.status === 'REMOVED' || log.status === 'EXPIRED') color = 0x95A5A6;
        
        const endsAtValue = log.endsat ? `<t:${Math.floor(Number(log.endsat) / 1000)}:R>` : 'Permanent / N/A';
        const statusEmoji = log.status === 'ACTIVE' ? '🟢' : (log.status === 'EXPIRED' ? '⚪' : (log.status === 'VOIDED' ? '❌' : '✅'));

        const caseEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`${emojis.case_id} Case Details: ${action}`)
            .setDescription(`Information for Case ID: \`${caseId}\``)
            .addFields(
                { name: `${emojis.user} Target User`, value: `<@${log.userid}> (\`${log.usertag || 'Unknown Tag'}\`)`, inline: true },
                { name: `${emojis.moderator} Moderator`, value: `<@${log.moderatorid}> (\`${log.moderatortag || 'Unknown Tag'}\`)`, inline: true },
                { name: `\u200B`, value: `\u200B`, inline: true }, // Espacio
                { name: `${emojis.reason} Reason`, value: log.reason.substring(0, 1024), inline: false },
                { name: `\u200B`, value: `\u200B`, inline: false }, // Espacio
                { name: `Action Type`, value: action, inline: true },
                { name: `${emojis.duration} Duration`, value: log.action_duration || 'N/A', inline: true },
                { name: `Status`, value: `${statusEmoji} ${log.status}`, inline: true }
            )
            .setFooter({ text: `Issued on: ${new Date(Number(log.timestamp)).toLocaleDateString()}` })
            .setTimestamp(Number(log.timestamp));
            
        
        if (log.endsat && log.status === 'ACTIVE' && (log.action === 'BAN' || log.action === 'TIMEOUT')) {
             caseEmbed.addFields(
                 { name: `\u200B`, value: `\u200B`, inline: false },
                 { name: 'Expiration', value: endsAtValue, inline: false }
             );
        }

        
        await interaction.editReply({ embeds: [caseEmbed] });
    },
};