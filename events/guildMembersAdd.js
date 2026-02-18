const { Events, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const antiNuke = require('../utils/antiNuke.js');
const db = require('../utils/db.js');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        
        await antiNuke.checkBotJoin(member);
        
        // Verification system
        try {
            const guildId = member.guild.id;
            
            // Check if verification is enabled for this guild
            const configRes = await db.query(
                "SELECT * FROM verification_config WHERE guildid = $1 AND enabled = true",
                [guildId]
            );
            
            if (configRes.rows.length === 0) return;
            
            const config = configRes.rows[0];
            
            // Check if user is already verified (returning member)
            const statusRes = await db.query(
                "SELECT verified FROM verification_status WHERE userid = $1 AND guildid = $2 AND verified = true",
                [member.id, guildId]
            );
            
            if (statusRes.rows.length > 0) {
                // Already verified — just give verified role
                if (config.verified_role_id) {
                    await member.roles.add(config.verified_role_id).catch(() => {});
                }
                return;
            }
            
            // Add unverified role if configured
            if (config.unverified_role_id) {
                await member.roles.add(config.unverified_role_id).catch(() => {});
            }
            
            // Send verification DM
            const verifyUrl = `${process.env.CALLBACK_URL?.replace('/auth/discord/callback', '') || 'http://localhost:3001'}/verify?guild=${guildId}`;
            
            const dmMessage = config.dm_message || 'Welcome! Please verify your account to access the server.';
            
            const embed = new EmbedBuilder()
                .setTitle(`🛡️ Verification Required`)
                .setDescription(`Welcome to **${member.guild.name}**!\n\n${dmMessage}`)
                .addFields(
                    { name: 'Why verification?', value: 'This helps protect the server from bots and malicious users.', inline: false },
                    { name: 'What happens next?', value: 'Complete the verification to gain access to the server.', inline: false }
                )
                .setColor('#667eea')
                .setFooter({ text: member.guild.name, iconURL: member.guild.iconURL() })
                .setTimestamp();
            
            const button = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('✅ Verify Here')
                    .setStyle(ButtonStyle.Link)
                    .setURL(verifyUrl)
            );
            
            await member.send({ embeds: [embed], components: [button] }).catch((err) => {
                console.log(`[VERIFY] Could not send DM to ${member.user.tag}: ${err.message}`);
            });
            
        } catch (error) {
            console.error('[VERIFY] Error in guildMemberAdd:', error);
        }
    },
};
