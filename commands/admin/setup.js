const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../utils/db.js');
const { emojis } = require('../../utils/config.js');

const generateSetupContent = async (interaction, guildId) => {
    
    const [logChannelsResult, guildSettingsResult, permissionsResult, rulesResult, antiNukeResult] = await Promise.all([
        db.query('SELECT * FROM log_channels WHERE guildid = $1', [guildId]),
        db.query('SELECT * FROM guild_settings WHERE guildid = $1', [guildId]),
        db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1 ORDER BY command_name', [guildId]),
        db.query('SELECT rule_order, warnings_count, action_type, action_duration FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]),
        db.query('SELECT antinuke_enabled, threshold_count, threshold_time FROM guild_backups WHERE guildid = $1', [guildId])
    ]);
    
    const logChannels = logChannelsResult.rows;
    const guildSettings = guildSettingsResult.rows[0] || {};
    const permissions = permissionsResult.rows;
    const rules = rulesResult.rows;
    const antiNukeSettings = antiNukeResult.rows[0] || {};
    
    const ruleSummary = rules.map(rule => `**#${rule.rule_order}**: ${rule.warnings_count} warns -> **${rule.action_type}**${rule.action_duration ? ` (${rule.action_duration})` : ''}`).join('\n') || '*No Automod rules set.*';
    const modLog = logChannels.find(c => c.log_type === 'modlog')?.channel_id;
    const cmdLog = logChannels.find(c => c.log_type === 'cmdlog')?.channel_id;
    const banAppeal = logChannels.find(c => c.log_type === 'banappeal')?.channel_id;
    const antiNukeLog = logChannels.find(c => c.log_type === 'antinuke')?.channel_id;
    const staffRoles = guildSettings.staff_roles ? guildSettings.staff_roles.split(',').map(r => `<@&${r}>`).join(', ') : 'Not Set';
    const isAntiNukeOn = antiNukeSettings.antinuke_enabled;

    const permsConfig = Object.entries(permissions.reduce((acc, p) => {
        (acc[p.command_name] = acc[p.command_name] || []).push(`<@&${p.role_id}>`);
        return acc;
    }, {})).map(([cmd, roles]) => `\`/${cmd}\`: ${roles.join(', ')}`).join('\n') || 'No custom permissions set.';

   const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`⚙️ ${interaction.guild.name}'s Setup Panel`)
        .setDescription(`Configure the bot using the buttons below.`)
        .addFields(
            { name: `${emojis.channel || '📺'} Log Channels`, value: `**Mod Log:** ${modLog ? `<#${modLog}>` : '❌'}\n**Command Log:** ${cmdLog ? `<#${cmdLog}>` : '❌'}\n**Ban Appeals:** ${banAppeal ? `<#${banAppeal}>` : '❌'}\n**Anti-Nuke Log:** ${antiNukeLog ? `<#${antiNukeLog}>` : '❌'}` },
            { name: `${emojis.role || '🛡️'} Roles`, value: `**Staff Roles:** ${staffRoles}` }, 
            { name: `${emojis.lock || '🔒'} Permissions`, value: permsConfig },
            { name: `${emojis.rules || '📜'} Automod Rules`, value: ruleSummary },
            { name: '☢️ Anti-Nuke', value: isAntiNukeOn ? `✅ **ENABLED**` : '❌ **DISABLED**' }
        );

    const mainRows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_channels').setLabel('Log Channels').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('Staff Roles').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_permissions').setLabel('Permissions').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_automod').setLabel('Automod').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('setup_antinuke').setLabel('Anti-Nuke').setStyle(isAntiNukeOn ? ButtonStyle.Success : ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('delete_all_data').setLabel('Reset Data').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cancel_setup').setLabel('Close').setStyle(ButtonStyle.Secondary)
        )
    ];
    
    return { embed, components: mainRows };
};

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Shows the main setup panel.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    generateSetupContent,

    async execute(interaction) {
     
        
        const guildId = interaction.guild.id;
        const { embed: mainEmbed, components: mainComponents } = await generateSetupContent(interaction, guildId);

        await interaction.editReply({ 
            embeds: [mainEmbed], 
            components: mainComponents
        });
    },
};