const { Events, ActivityType } = require('discord.js');
const db = require('../utils/db.js');
const { startScheduler, resumePunishmentsOnStart } = require('../utils/temporary_punishment_handler.js');
const antiNuke = require('../utils/antiNuke.js');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        client.schedulerStarted = false;
        
        console.log(`✅ Ready! Logged in as ${client.user.tag}`);
        
        const resumedCount = await resumePunishmentsOnStart(client);
        startScheduler(client);
        
        console.log(`[INFO] Completed timer resumption process. Total resumed: ${resumedCount}.`);

        const keepAliveInterval = 24 * 60 * 60 * 1000; 
        setInterval(async () => {
            try {
                await db.query('SELECT 1');
            } catch (error) {
                console.error("[DB KEEP-ALIVE] Error:", error.message);
            }
        }, keepAliveInterval);

        setInterval(() => {
            client.guilds.cache.forEach(guild => {
                antiNuke.createBackup(guild);
            });
        }, 86400000);

        const updateStatus = () => {
            const guildId = process.env.DISCORD_GUILD_ID;
            const guild = client.guilds.cache.get(guildId);
            
            if (guild) {
                client.user.setPresence({
                    activities: [{ 
                        name: `Moderating ${guild.name} | Made by Ukirama`, 
                        type: ActivityType.Watching 
                    }],
                    status: 'online',
                });
            } else {
                client.user.setPresence({
                    activities: [{ 
                        name: `Made by Ukirama`, 
                        type: ActivityType.Watching 
                    }],
                    status: 'online',
                });
            }
        };

        updateStatus();

        setInterval(updateStatus, 3600000);
    },
};
