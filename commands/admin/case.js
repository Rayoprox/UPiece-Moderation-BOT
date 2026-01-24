const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const { error } = require('../../utils/embedFactory.js');


const ACTION_COLORS = {
    BAN: 0xAA0000,      
    KICK: 0xE67E22,    
    TIMEOUT: 0xFFFFFF,  
    MUTE: 0xFFFFFF,     
    WARN: 0xF1C40F,     
    UNBAN: 0x2ECC71,  
    UNMUTE: 0x2ECC71,  
    SOFTBAN: 0xE67E22,  
    VOIDED: 0x546E7A,   
    DEFAULT: 0x3498DB   
};

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('case')
        .setDescription('View details of a specific moderation case.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addStringOption(option => option.setName('case_id').setDescription('The Case ID to lookup.').setRequired(true)),

    async execute(interaction) {
        const caseId = interaction.options.getString('case_id').trim();
        const guildId = interaction.guild.id;

        const result = await db.query('SELECT * FROM modlogs WHERE caseid = $1 AND guildid = $2', [caseId, guildId]);
        
        if (result.rows.length === 0) {
            return interaction.editReply({ embeds: [error(`Case ID \`${caseId}\` not found.`)], flags: [MessageFlags.Ephemeral] });
        }

        const log = result.rows[0];
        const actionUpper = log.action ? log.action.toUpperCase() : 'UNKNOWN';
        

        let embedColor = ACTION_COLORS.DEFAULT;
        if (log.status === 'VOIDED') embedColor = ACTION_COLORS.VOIDED;
        else if (ACTION_COLORS[actionUpper]) embedColor = ACTION_COLORS[actionUpper];

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`Case ${log.caseid}`) 
            .addFields(
                { name: 'User', value: `${log.usertag} (${log.userid})`, inline: true },
                { name: 'Staff', value: log.moderatortag ? `${log.moderatortag} (${log.moderatorid})` : 'Unknown', inline: true },
                { name: 'Action', value: actionUpper, inline: true },
                { name: 'Reason', value: log.reason || 'No reason specified', inline: false }
            );

       
        if (log.action_duration) {
            embed.addFields({ name: 'Duration', value: log.action_duration, inline: true });
        }
        
        if (log.status && log.status !== 'EXECUTED') {
            embed.addFields({ name: 'Status', value: log.status, inline: true });
        }

        embed.setFooter({ text: `Date: ${new Date(parseInt(log.timestamp)).toLocaleString()}` });

        await interaction.editReply({ embeds: [embed] });
    },
};