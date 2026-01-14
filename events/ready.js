const { Events, ActivityType } = require('discord.js');
const db = require('../utils/db.js');
const { startScheduler, resumePunishmentsOnStart } = require('../utils/temporary_punishment_handler.js');
const antiNuke = require('../utils/antiNuke.js');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        client.schedulerStarted = false;
        
        console.log(`Ready! Logged in as ${client.user.tag}`);
        
        const resumedCount = await resumePunishmentsOnStart(client);
        startScheduler(client);
        
        console.log(`[INFO] Completed timer resumption process. Total resumed: ${resumedCount}.`);

        const keepAliveInterval = 24 * 60 * 60 * 1000; 
        setInterval(async () => {
            try {
                console.log("[DB KEEP-ALIVE] Pinging database to prevent sleep...");
                await db.query('SELECT 1');
                console.log("[DB KEEP-ALIVE] Database ping successful.");
            } catch (error) {
                console.error("[DB KEEP-ALIVE] Failed to ping database:", error.message);
            }
        }, keepAliveInterval);

        setInterval(() => {
            client.guilds.cache.forEach(guild => {
                antiNuke.createBackup(guild);
            });
        }, 86400000);

        client.user.setPresence({
            activities: [{ name: 'Moderating Kobaria', type: ActivityType.Watching }],
            status: 'online',
        });
    },
};