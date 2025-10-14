const { Events, ActivityType } = require('discord.js');
const db = require('../utils/db.js');
const { startScheduler, resumePunishmentsOnStart } = require('../utils/temporary_punishment_handler.js');

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
       

        client.user.setPresence({
            activities: [{ name: 'Moderating Realm Of Curses', type: ActivityType.Watching }],
            status: 'online',
        });
    },
};