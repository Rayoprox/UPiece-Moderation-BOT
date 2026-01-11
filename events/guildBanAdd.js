const { Events, AuditLogEvent } = require('discord.js');

module.exports = {
    name: Events.GuildBanAdd,
    async execute(ban) {
     

        const db = ban.client.db;
        const guild = ban.guild;
        const user = ban.user;
        const currentTimestamp = Date.now();

    
        await new Promise(resolve => setTimeout(resolve, 1000));

      
        const fetchedLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberBanAdd,
        });

        const banLog = fetchedLogs.entries.first();

    
        if (!banLog || banLog.target.id !== user.id) {
            console.log(`[AUDIT LOG] Ban for ${user.tag} occurred, but no corresponding audit log entry was found. Ignoring.`);
            return;
        }

        const { executor, reason } = banLog;
        
        
        if (executor.id === ban.client.user.id) {
            console.log(`[AUDIT LOG] Ban for ${user.tag} ignored (Initiated by the bot).`);
            return;
        }

    
        const finalReason = (reason || '').trim();
        if (finalReason.includes('[CMD]')) {
            console.log(`[AUDIT LOG] Ban for ${user.tag} ignored (Reason contains command flag).`);
            return;
        }

        const cleanExecutorTag = executor.tag.trim();
        const cleanUserTag = user.tag.trim();
        
        console.log(`[INFO] Manual ban of ${cleanUserTag} by ${cleanExecutorTag} detected.`);

        const caseId = `MANUAL-${currentTimestamp}`;
        const endsAt = null;
        const isAppealable = 1; 
        const dmStatus = 'N/A'; 

  
        await db.query(`
            INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, endsAt, appealable, dmstatus, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
            caseId, guild.id, 'BAN', user.id, cleanUserTag, executor.id, cleanExecutorTag, 
            finalReason, currentTimestamp, endsAt, isAppealable, dmStatus, 'PERMANENT'
        ]);
        
        console.log(`[INFO] Created database entry for manual ban. Case ID: ${caseId}`);
       
    },
};