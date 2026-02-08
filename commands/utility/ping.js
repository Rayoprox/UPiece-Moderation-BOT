const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { emojis } = require('../../utils/config.js');

module.exports = {
    deploy: 'all',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription("Checks the bot's system latency and status."),

    async execute(interaction) { 
        
        const client = interaction.client; 

        const dbStart = Date.now();
        try {
            if (client.db) await client.db.query('SELECT 1'); 
        } catch (e) { }
        const dbLatency = Date.now() - dbStart;

        const apiLatency = client.ws.ping;
        const appLatency = Date.now() - interaction.createdTimestamp;

       
        let statusColor = 0x2ECC71; // Green
        let statusEmoji = emojis?.check || '🟢';
        let statusText = 'Excellent';

        if (apiLatency > 200 || dbLatency > 200) {
            statusColor = 0xF1C40F;
            statusEmoji = '🟡';
            statusText = 'Fair';
        }
        if (apiLatency > 500 || dbLatency > 500) {
            statusColor = 0xE74C3C; 
            statusEmoji = '🔴';
            statusText = 'High Load';
        }

     
        const days = Math.floor(client.uptime / 86400000);
        const hours = Math.floor(client.uptime / 3600000) % 24;
        const minutes = Math.floor(client.uptime / 60000) % 60;
        const uptimeStr = `${days}d ${hours}h ${minutes}m`;

        const mainGuildName = interaction.client.guilds.cache.get(process.env.DISCORD_GUILD_ID)?.name;
        const serverName = mainGuildName || interaction.guild?.name || 'this server';
        const embed = new EmbedBuilder()
            .setColor(statusColor)
            .setTitle(`${statusEmoji} System Status: ${statusText}`)
            .setDescription(`**${serverName}** is currently operational. v1`)
            .addFields(
                { 
                    name: '📡 API Latency', 
                    value: `\`\`\`yml\n${apiLatency}ms\`\`\``, 
                    inline: true 
                },
                { 
                    name: '⚡ App Latency', 
                    value: `\`\`\`yml\n${appLatency}ms\`\`\``, 
                    inline: true 
                },
                { 
                    name: '🗄️ Database', 
                    value: `\`\`\`yml\n${dbLatency}ms\`\`\``, 
                    inline: true 
                },
                {
                    name: '⏱️ Uptime',
                    value: `\`${uptimeStr}\``,
                    inline: true
                },
                {
                    name: '💾 Memory Usage',
                    value: `\`${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\``,
                    inline: true
                }
            )
            .setFooter({ 
                text: `Requested by ${interaction.user.username}`, 
                iconURL: interaction.user.displayAvatarURL() 
            })
            .setTimestamp();

      
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.reply({ embeds: [embed] });
        }
    },
};