const { EmbedBuilder } = require('discord.js');
const vpnDetector = require('./vpnDetector');

/**
 * Analyzes user suspicion based on multiple factors
 * @param {Client} client - Discord client
 * @param {Object} db - Database connection
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Guild ID
 * @param {string} ip - User's IP address
 * @param {string} username - Username for logging
 * @returns {Promise<Object>} Suspicion analysis result
 */
async function checkUserSuspicion(client, db, userId, guildId, ip, username, fingerprint) {
    try {
        let riskScore = 0;
        const flags = [];
        
        // Fetch Discord account info
        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) {
            flags.push('❌ Could not fetch user data');
            riskScore += 10;
        }
        
        // 1. Check account age (new accounts are suspicious)
        if (user) {
            const accountAge = Date.now() - user.createdTimestamp;
            const daysOld = Math.floor(accountAge / (1000 * 60 * 60 * 24));
            
            if (daysOld < 7) {
                flags.push(`🆕 Account created ${daysOld} days ago (very new)`);
                riskScore += 40;
            } else if (daysOld < 30) {
                flags.push(`🆕 Account created ${daysOld} days ago (new)`);
                riskScore += 20;
            } else if (daysOld < 90) {
                flags.push(`📅 Account age: ${daysOld} days`);
                riskScore += 5;
            }
        }
        
        // 2. Check if IP matches banned users
        const bannedWithSameIp = await db.query(
            `SELECT DISTINCT m.userid, m.usertag 
             FROM modlogs m 
             JOIN user_ips u ON m.userid = u.userid 
             WHERE m.guildid = $1 
             AND m.action = 'BAN' 
             AND m.status = 'ACTIVE' 
             AND u.ip_address = $2 
             AND m.userid != $3
             LIMIT 5`,
            [guildId, ip, userId]
        );
        
        if (bannedWithSameIp.rows.length > 0) {
            const usernames = bannedWithSameIp.rows.map(r => r.usertag).join(', ');
            flags.push(`🚨 IP matches ${bannedWithSameIp.rows.length} banned user(s): ${usernames}`);
            riskScore += 60;
        }
        
        // 3. Check if this user has previous bans
        const userBans = await db.query(
            `SELECT COUNT(*) as count 
             FROM modlogs 
             WHERE userid = $1 
             AND action = 'BAN' 
             AND status = 'ACTIVE'`,
            [userId]
        );
        
        if (parseInt(userBans.rows[0].count) > 0) {
            flags.push(`⛔ User has ${userBans.rows[0].count} active ban(s)`);
            riskScore += 50;
        }
        
        // 4. Check how many different IPs this user has used
        const ipCount = await db.query(
            `SELECT COUNT(DISTINCT ip_address) as count 
             FROM user_ips 
             WHERE userid = $1`,
            [userId]
        );
        
        const uniqueIps = parseInt(ipCount.rows[0].count);
        if (uniqueIps > 5) {
            flags.push(`🔄 User has ${uniqueIps} different IP addresses (suspicious)`);
            riskScore += 30;
        } else if (uniqueIps > 3) {
            flags.push(`🔄 User has ${uniqueIps} different IP addresses`);
            riskScore += 10;
        }
        
        // 5. Check if IP has been used by many different accounts
        const accountsWithSameIp = await db.query(
            `SELECT COUNT(DISTINCT userid) as count 
             FROM user_ips 
             WHERE ip_address = $1 
             AND guildid = $2`,
            [ip, guildId]
        );
        
        const accountsOnIp = parseInt(accountsWithSameIp.rows[0].count);
        if (accountsOnIp > 5) {
            flags.push(`👥 IP shared by ${accountsOnIp} different users (VPN/Proxy likely)`);
            riskScore += 20;
        } else if (accountsOnIp > 2) {
            flags.push(`👥 IP shared by ${accountsOnIp} users`);
            riskScore += 5;
        }
        
        // 5.5 Local VPN/Datacenter detection (unlimited, no API)
        if (ip && vpnDetector.ready) {
            const vpnResult = vpnDetector.check(ip);
            if (vpnResult.isVPN) {
                flags.push('🔒 IP detected as **VPN/Proxy** (local database)');
                riskScore += 35;
            } else if (vpnResult.isDatacenter) {
                flags.push('🏢 IP detected as **Datacenter/Hosting** (local database)');
                riskScore += 25;
            }
        }
        
        // 6. Fingerprint match with banned users
        if (fingerprint) {
            const fpBanned = await db.query(
                `SELECT DISTINCT m.userid, m.usertag
                 FROM modlogs m
                 JOIN user_ips u ON m.userid = u.userid
                 WHERE m.guildid = $1
                 AND m.action = 'BAN'
                 AND m.status = 'ACTIVE'
                 AND u.fingerprint = $2
                 AND m.userid != $3
                 LIMIT 5`,
                [guildId, fingerprint, userId]
            );
            
            if (fpBanned.rows.length > 0) {
                const names = fpBanned.rows.map(r => r.usertag).join(', ');
                flags.push(`🖥️ FINGERPRINT matches ${fpBanned.rows.length} banned user(s): ${names}`);
                riskScore += 80;
            }
            
            // 7. Fingerprint match with other (non-banned) accounts
            const fpOthers = await db.query(
                `SELECT DISTINCT userid
                 FROM user_ips
                 WHERE fingerprint = $1
                 AND guildid = $2
                 AND userid != $3`,
                [fingerprint, guildId, userId]
            );
            
            if (fpOthers.rows.length > 0) {
                flags.push(`🖥️ Same device/browser used by ${fpOthers.rows.length} other account(s)`);
                riskScore += 40;
            }
        }
        
        // 8. Check default Discord avatar
        if (user && user.avatar === null) {
            flags.push('🖼️ Using default Discord avatar');
            riskScore += 15;
        }
        
        // Determine risk level
        let riskLevel = 'LOW';
        let riskColor = 0x2ecc71; // Green
        
        if (riskScore >= 70) {
            riskLevel = 'CRITICAL';
            riskColor = 0xe74c3c; // Red
        } else if (riskScore >= 40) {
            riskLevel = 'HIGH';
            riskColor = 0xe67e22; // Orange
        } else if (riskScore >= 20) {
            riskLevel = 'MEDIUM';
            riskColor = 0xf39c12; // Yellow
        }
        
        // Update risk score in database
        await db.query(
            `UPDATE user_ips 
             SET risk_score = $1 
             WHERE ctid = (
                SELECT ctid FROM user_ips 
                WHERE userid = $2 AND guildid = $3 
                ORDER BY timestamp DESC 
                LIMIT 1
             )`,
            [riskScore, userId, guildId]
        );
        
        return {
            riskScore,
            riskLevel,
            flags,
            accountAge: user ? Math.floor((Date.now() - user.createdTimestamp) / (1000 * 60 * 60 * 24)) : null
        };
        
    } catch (error) {
        console.error('[SUSPICION-CHECK] Error:', error);
        return {
            riskScore: 0,
            riskLevel: 'UNKNOWN',
            flags: ['Error during analysis'],
            accountAge: null
        };
    }
}

module.exports = { checkUserSuspicion };
