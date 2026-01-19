const { Events, EmbedBuilder } = require('discord.js');
const db = require('../utils/db.js');
const { emojis } = require('../utils/config.js'); // For specific icons if needed
const ms = require('ms');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot || !message.guild) return;

        const guildId = message.guild.id;
        const userId = message.author.id;

        const afkCheck = await db.query('SELECT * FROM afk_users WHERE userid = $1 AND guildid = $2', [userId, guildId]);
        
        if (afkCheck.rows.length > 0) {
            await db.query('DELETE FROM afk_users WHERE userid = $1 AND guildid = $2', [userId, guildId]);
            
            const welcomeEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setDescription(`${emojis.success || '✅'} Welcome back ${message.author}! I've removed your AFK status.`);
            
            const welcomeMsg = await message.reply({ embeds: [welcomeEmbed] });
            setTimeout(() => welcomeMsg.delete().catch(() => {}), 5000);
        }

        // --- 2. NOTIFY ON AFK MENTION ---
        if (message.mentions.users.size > 0) {
            message.mentions.users.forEach(async (user) => {
                if (user.id === userId) return;

                const res = await db.query('SELECT * FROM afk_users WHERE userid = $1 AND guildid = $2', [user.id, guildId]);
                
                if (res.rows.length > 0) {
                    const data = res.rows[0];
                    const timeAgo = ms(Date.now() - parseInt(data.timestamp), { long: true });

                    const afkNotifyEmbed = new EmbedBuilder()
                        .setColor(0xF1C40F)
                        .setAuthor({ name: `${user.tag} is currently away`, iconURL: user.displayAvatarURL() })
                        .setDescription(`${emojis.duration || '⏰'} **Reason:** ${data.reason}\n**Away for:** ${timeAgo}`)
                        .setTimestamp();

                    const response = await message.reply({ embeds: [afkNotifyEmbed] });
                    setTimeout(() => response.delete().catch(() => {}), 5000);
                }
            });
        }
    },
};