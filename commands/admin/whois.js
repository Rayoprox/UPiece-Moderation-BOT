const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../utils/db.js');
const { emojis } = require('../../utils/config.js');

module.exports = {
    deploy: 'main',
    isPublic: false, 
    data: new SlashCommandBuilder()
        .setName('whois')
        .setDescription('Displays advanced information and permissions about a user.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user (ID or mention) to look up.')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('public')
                .setDescription('Set to true to make the response visible to everyone.')
                .setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const guildId = interaction.guild.id;

        const [targetMember, banEntry, logCountResult] = await Promise.all([
            interaction.guild.members.fetch(targetUser.id).catch(() => null),
            interaction.guild.bans.fetch(targetUser.id).catch(() => null),
            db.query('SELECT COUNT(*) FROM modlogs WHERE userid = $1 AND guildid = $2', [targetUser.id, guildId])
        ]);

        const totalModLogs = logCountResult.rows[0].count;
        
        let color = 0x3498DB; 
        if (targetUser.bot) color = 0x9B59B6;
        else if (banEntry) color = 0xE74C3C;
        else if (targetMember) color = targetMember.displayColor || 0x3498DB;

        const whoisEmbed = new EmbedBuilder()
            .setColor(color)
            .setAuthor({ name: `${targetUser.tag} ${targetUser.bot ? '[BOT]' : ''}`, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }));

      
        whoisEmbed.addFields({
            name: `${emojis.user || '👤'} User Identity`,
            value: `**Mention:** <@${targetUser.id}>\n**ID:** \`${targetUser.id}\`\n**Created:** <t:${Math.floor(targetUser.createdTimestamp / 1000)}:F> (<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>)`,
            inline: false
        });

      
        if (targetMember) {
            const joinedTimestamp = Math.floor(targetMember.joinedTimestamp / 1000);
            
            const roles = targetMember.roles.cache
                .filter(r => r.id !== guildId)
                .sort((a, b) => b.position - a.position)
                .map(r => r.toString());
            
            const rolesDisplay = roles.length > 0 
                ? (roles.length > 10 ? `${roles.slice(0, 10).join(', ')} ...and ${roles.length - 10} more` : roles.join(', ')) 
                : 'No roles';

          
            const keyPermissions = [
                'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 
                'BanMembers', 'KickMembers', 'ManageMessages', 'MentionEveryone', 
                'ViewAuditLog', 'ManageWebhooks', 'ManageNicknames'
            ];
            
            let permissionsDisplay = [];
            if (targetMember.permissions.has(PermissionsBitField.Flags.Administrator)) {
                permissionsDisplay.push('🔥 **ADMINISTRATOR**');
            } else {
                const memberPerms = targetMember.permissions.toArray();
                const matchedPerms = memberPerms.filter(p => keyPermissions.includes(p));
                permissionsDisplay = matchedPerms.map(p => `\`${p}\``);
                if (permissionsDisplay.length === 0) permissionsDisplay.push('Regular Member');
            }

            whoisEmbed.addFields(
                {
                    name: `${emojis.info || '📅'} Server Info`,
                    value: `**Joined:** <t:${joinedTimestamp}:F> (<t:${joinedTimestamp}:R>)\n**Nickname:** ${targetMember.nickname || 'None'}`,
                    inline: false
                },
                {
                    name: `${emojis.role || '🛡️'} Roles [${roles.length}]`,
                    value: rolesDisplay,
                    inline: false
                },
                {
                    name: `${emojis.lock || '🔑'} Key Permissions`,
                    value: permissionsDisplay.join(', '),
                    inline: false
                }
            );
        } else {
            whoisEmbed.addFields({ name: '⚠️ Membership', value: 'User is NOT in this server.', inline: false });
        }

       
        let modStatusValue = `**Total Logs:** ${totalModLogs}`;
        
        const activeWarningsResult = await db.query("SELECT COUNT(*) AS count FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'WARN' AND status = 'ACTIVE'", [targetUser.id, guildId]);
        modStatusValue += `\n**Active Warnings:** ${activeWarningsResult.rows[0].count}`;

        if (banEntry) {
            modStatusValue += `\n**Status:** 🔴 **BANNED**\n**Reason:** ${banEntry.reason || 'None'}`;
        } else if (targetMember && targetMember.isCommunicationDisabled()) {
            const timeoutEnd = Math.floor(targetMember.communicationDisabledUntilTimestamp / 1000);
            modStatusValue += `\n**Status:** 🟡 **MUTED** until <t:${timeoutEnd}:R>`;
        } else {
            modStatusValue += `\n**Status:** 🟢 Clean`;
        }

        whoisEmbed.addFields({
            name: `${emojis.rules || '⚖️'} Moderation`,
            value: modStatusValue,
            inline: false
        });

        whoisEmbed.setFooter({ text: `Requested by ${interaction.user.tag}` }).setTimestamp();
        await interaction.editReply({ embeds: [whoisEmbed] });
    },
};