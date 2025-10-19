const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const { emojis } = require('../../utils/config.js');

module.exports = {
    deploy: 'main',
    isPublic: false, 
    data: new SlashCommandBuilder()
        .setName('whois')
        .setDescription('Displays detailed administrative information about a user.')
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
        const isPublic = interaction.options.getBoolean('public') || false;
        const guildId = interaction.guild.id;

    
        const replyOptions = { embeds: [], flags: isPublic ? [] : [MessageFlags.Ephemeral] };
        
        const targetId = targetUser.id;
        const targetTag = targetUser.tag;
        
        const [targetMember, banEntry, logCountResult] = await Promise.all([
          
            interaction.guild.members.fetch(targetId).catch(() => null),
           
            interaction.guild.bans.fetch(targetId).catch(() => null),
            
            db.query('SELECT COUNT(*) FROM modlogs WHERE userid = $1 AND guildid = $2', [targetId, guildId])
        ]);

        const totalModLogs = logCountResult.rows[0].count;
        
        let color = 0x3498DB; 
        if (banEntry) color = 0xAA0000;
        else if (targetMember) color = targetMember.displayColor || 0x3498DB; 

      
        const whoisEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`👤 Whois: ${targetTag}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 128 }))
            .addFields(
                { name: 'General Info', value: `**ID:** \`${targetId}\`\n**Account Created:** <t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: false }
            );

     
        let modStatus = `\n**Mod Logs Total:** ${totalModLogs} cases`;

        if (banEntry) {
             const banReason = banEntry.reason || 'No reason specified';
             modStatus += `\n**Ban Status:** ${emojis.ban} **Currently Banned**\n**Ban Reason:** \`${banReason.substring(0, 100)}...\``;
        } else {
             modStatus += `\n**Ban Status:** ✅ Not Banned`;
        }

        const activeWarningsResult = await db.query("SELECT COUNT(*) AS count FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'WARN' AND status = 'ACTIVE'", [targetId, guildId]);
        const activeWarningsCount = activeWarningsResult.rows[0].count;
        
        if (activeWarningsCount > 0) {
            modStatus += `\n**Active Warnings:** ${emojis.warn} ${activeWarningsCount}`;
        }
        
        whoisEmbed.addFields({ name: 'Moderation & Safety', value: modStatus, inline: false });

        if (targetMember) {
            const isTimeout = targetMember.isCommunicationDisabled();
            const joinDate = `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>`;
            
            let timeoutInfo = '';
            if (isTimeout) {
                const endsAt = targetMember.communicationDisabledUntilTimestamp;
                timeoutInfo = `${emojis.mute} **Timed Out** (Ends: <t:${Math.floor(endsAt / 1000)}:R>)`;
            } else {
                timeoutInfo = '✅ Not Timed Out';
            }

            const rolesList = targetMember.roles.cache
                .filter(r => r.id !== guildId) 
                .sort((a, b) => b.position - a.position)
                .map(r => r)
                .slice(0, 10) 
                .join(', ') || 'None';

            whoisEmbed.addFields({ 
                name: 'Server Membership', 
                value: `**Joined Server:** ${joinDate}\n**Highest Role:** ${targetMember.roles.highest}\n**Status:** ${isTimeout ? timeoutInfo : 'Active Member'}`,
                inline: true
            });
            
           
            if (rolesList !== 'None') {
                whoisEmbed.addFields({ 
                    name: `Roles (${targetMember.roles.cache.size - 1})`, 
                    value: rolesList, 
                    inline: false 
                });
            }
        } else {
            whoisEmbed.addFields({ name: 'Server Membership', value: '❌ Not in server.', inline: true });
        }



        whoisEmbed.setFooter({ text: `Requested by ${interaction.user.tag}` }).setTimestamp();

        await interaction.editReply({ ...replyOptions, embeds: [whoisEmbed] });
    },
};