const db = require('../utils/db.js');

/**
 * Auto-cleanup function for data deletion requests
 * Automatically deletes user data after 24 hours if not manually reviewed
 */
async function processDeletionRequests(client) {
    try {
        const now = Date.now();
        
        // Find all pending deletion requests that have passed auto-delete time
        const pendingRes = await db.query(
            "SELECT * FROM data_deletion_requests WHERE status = 'PENDING' AND auto_delete_at <= $1",
            [now]
        );
        
        for (const request of pendingRes.rows) {
            const userId = request.userid;
            
            console.log(`[AUTO-DELETE] Processing automatic deletion for user ${userId} (${request.username})`);
            
            try {
                // Remove verified roles before deleting data
                try {
                    const statusRows = await db.query("SELECT guildid FROM verification_status WHERE userid = $1 AND verified = true", [userId]);
                    for (const row of statusRows.rows) {
                        try {
                            const guild = await client.guilds.fetch(row.guildid).catch(() => null);
                            if (!guild) continue;
                            const member = await guild.members.fetch(userId).catch(() => null);
                            if (!member) continue;
                            const configRes = await db.query("SELECT verified_role_id, unverified_role_id FROM verification_config WHERE guildid = $1", [row.guildid]);
                            if (configRes.rows.length > 0) {
                                const { verified_role_id, unverified_role_id } = configRes.rows[0];
                                if (verified_role_id && member.roles.cache.has(verified_role_id)) await member.roles.remove(verified_role_id).catch(() => {});
                                if (unverified_role_id) await member.roles.add(unverified_role_id).catch(() => {});
                            }
                        } catch (e) { /* guild/member not accessible */ }
                    }
                } catch (e) { console.error('[AUTO-DELETE] Error removing roles:', e); }

                // Delete all user data
                await db.query("DELETE FROM verification_status WHERE userid = $1", [userId]);
                await db.query("DELETE FROM user_ips WHERE userid = $1", [userId]);
                await db.query("DELETE FROM modlogs WHERE userid = $1", [userId]);
                await db.query("DELETE FROM afk_users WHERE userid = $1", [userId]);
                await db.query("DELETE FROM pending_appeals WHERE userid = $1", [userId]);
                await db.query("DELETE FROM ban_appeals WHERE user_id = $1", [userId]);
                
                // Mark request as completed
                await db.query(
                    "UPDATE data_deletion_requests SET status = 'AUTO_COMPLETED', deleted_at = $1 WHERE userid = $2",
                    [now, userId]
                );
                
                // Try to notify user
                try {
                    const user = await client.users.fetch(userId);
                    await user.send(`✅ Your data deletion request has been automatically processed after 24 hours. All your data has been removed from our systems.`);
                } catch (e) {
                    // User might have DMs disabled
                    console.log(`[AUTO-DELETE] Could not DM user ${userId}: ${e.message}`);
                }
                
                console.log(`[AUTO-DELETE] Successfully deleted data for user ${userId}`);
                
            } catch (error) {
                console.error(`[AUTO-DELETE] Error deleting data for user ${userId}:`, error);
                // Mark as failed but don't retry
                await db.query(
                    "UPDATE data_deletion_requests SET status = 'FAILED' WHERE userid = $1",
                    [userId]
                );
            }
        }
        
        if (pendingRes.rows.length > 0) {
            console.log(`[AUTO-DELETE] Processed ${pendingRes.rows.length} automatic deletion(s)`);
        }
        
    } catch (error) {
        console.error('[AUTO-DELETE] Error in deletion scheduler:', error);
    }
}

/**
 * Start the deletion request scheduler
 * Checks every hour for expired deletion requests
 */
function startDeletionScheduler(client) {
    // Run immediately on startup
    processDeletionRequests(client);
    
    // Then run every hour (3600000 ms)
    setInterval(() => {
        processDeletionRequests(client);
    }, 60 * 60 * 1000); // 1 hour
    
    console.log('[AUTO-DELETE] Deletion scheduler started (interval: 1 hour)');
}

module.exports = { startDeletionScheduler, processDeletionRequests };
