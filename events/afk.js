const { Events, EmbedBuilder } = require('discord.js');
const db = require('../utils/db.js');
const { emojis } = require('../utils/config.js');
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
            
            const wMsg = await message.reply({ embeds: [welcomeEmbed] }).catch(() => {});
  
            if (wMsg) setTimeout(() => wMsg.delete().catch(() => {}), 5000);
        }

      
        if (message.mentions.users.size > 0) {
            for (const user of message.mentions.users.values()) {
                if (user.id === userId) continue; 
                const res = await db.query('SELECT * FROM afk_users WHERE userid = $1 AND guildid = $2', [user.id, guildId]);
                
                if (res.rows.length > 0) {
                    const data = res.rows[0];
                 
                    const timeAgo = ms(Date.now() - parseInt(data.timestamp), { long: true });
                    
                    const afkNotify = new EmbedBuilder()
                        .setColor(0xF1C40F)
                        .setAuthor({ name: `${user.tag} is currently away`, iconURL: user.displayAvatarURL() })
                        .setDescription(`${emojis.duration || '⏰'} **Reason:** ${data.reason}\n**Away for:** ${timeAgo}`)
                        .setTimestamp();
                    
                    const r = await message.reply({ embeds: [afkNotify] }).catch(() => {});
                    if (r) setTimeout(() => r.delete().catch(() => {}), 5000);
                }
            }
        }
    },
};
