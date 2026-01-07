const { AuditLogEvent, PermissionFlagsBits, ChannelType, EmbedBuilder, UserFlags, OverwriteType } = require('discord.js');
const db = require('./db.js');

const limitCache = new Map(); 
const triggeredUsers = new Set(); 
const restoringGuilds = new Set();
const backingUpGuilds = new Set(); // <--- NUEVO: Freno para backups

// --- 1. BACKUP & RESTORE (SISTEMA AVANZADO) ---
async function createBackup(guild) {
    if (!guild) return false;
    
    // 🔒 FRENO DE BACKUP: Evitar spam de guardado
    if (backingUpGuilds.has(guild.id)) {
        console.log(`[BACKUP] ⚠️ Backup already in progress for ${guild.name}.`);
        return 'IN_PROGRESS';
    }
    backingUpGuilds.add(guild.id);

    try {
        const channels = guild.channels.cache.map(c => ({
            id: c.id, 
            name: c.name, 
            type: c.type, 
            parentId: c.parentId, 
            parentName: c.parent ? c.parent.name : null, 
            position: c.position, 
            permissionOverwrites: c.permissionOverwrites.cache.map(p => {
                let roleName = null;
                if (p.type === OverwriteType.Role) {
                    const role = guild.roles.cache.get(p.id);
                    if (role) roleName = role.name;
                }
                return { 
                    id: p.id, 
                    type: p.type, 
                    allow: p.allow.bitfield.toString(), 
                    deny: p.deny.bitfield.toString(),
                    roleName: roleName 
                };
            })
        }));

        const roles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => ({
            id: r.id, 
            name: r.name, 
            color: r.color, 
            hoist: r.hoist, 
            permissions: r.permissions.bitfield.toString(), 
            position: r.position 
        }));

        const backupData = { channels, roles, timestamp: Date.now() };

        await db.query(`
            INSERT INTO guild_backups (guildid, data, last_backup) 
            VALUES ($1, $2, $3) 
            ON CONFLICT (guildid) DO UPDATE 
            SET data = $2, last_backup = $3
        `, [guild.id, backupData, Date.now()]);

        return 'SUCCESS';
    } catch (e) {
        console.error(`[BACKUP ERROR] Guild ${guild.id}:`, e);
        return 'ERROR';
    } finally {
        backingUpGuilds.delete(guild.id); // Liberar el freno
    }
}

async function restoreGuild(guild) {
    if (restoringGuilds.has(guild.id)) return 'IN_PROGRESS';
    restoringGuilds.add(guild.id);

    try {
        const result = await db.query('SELECT data FROM guild_backups WHERE guildid = $1', [guild.id]);
        if (result.rows.length === 0) return 'NO_DATA';
        
        const { roles: backupRoles, channels: backupChannels } = result.rows[0].data;
        console.log(`[RESTORE] 🛡️ Starting DEEP restoration for ${guild.name}...`);

        // --- FASE 1: LIMPIEZA ---
        const currentRoles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed && r.editable);
        for (const role of currentRoles.values()) {
            const isInBackup = backupRoles.some(br => br.name === role.name); 
            if (!isInBackup) await role.delete('Anti-Nuke Cleanup').catch(() => {});
        }

        const currentChannels = guild.channels.cache.filter(c => c.deletable);
        for (const channel of currentChannels.values()) {
            const isInBackup = backupChannels.some(bc => bc.name === channel.name && bc.type === channel.type);
            if (!isInBackup) await channel.delete('Anti-Nuke Cleanup').catch(() => {});
        }

        // --- FASE 2: RESTAURAR ROLES ---
        backupRoles.sort((a, b) => b.position - a.position);

        for (const r of backupRoles) {
            const exists = guild.roles.cache.find(role => role.name === r.name);
            if (!exists) {
                await guild.roles.create({
                    name: r.name,
                    color: r.color,
                    hoist: r.hoist,
                    permissions: BigInt(r.permissions),
                    position: r.position, 
                    reason: 'Anti-Nuke Restore'
                }).catch(() => {});
            }
        }

        // --- FASE 3: RESTAURAR CANALES ---
        const resolveOverwrites = (savedOverwrites) => {
            return savedOverwrites.map(o => {
                let targetId = o.id; 
                
                if (o.type === OverwriteType.Role) {
                    if (o.roleName === '@everyone') {
                        targetId = guild.roles.everyone.id;
                    } else if (o.roleName) {
                        const newRole = guild.roles.cache.find(r => r.name === o.roleName);
                        if (newRole) targetId = newRole.id;
                        else return null; 
                    }
                }
                return {
                    id: targetId,
                    type: o.type,
                    allow: BigInt(o.allow),
                    deny: BigInt(o.deny)
                };
            }).filter(o => o !== null); 
        };

        const categories = backupChannels.filter(c => c.type === ChannelType.GuildCategory);
        for (const c of categories) {
            if (!guild.channels.cache.find(ch => ch.name === c.name && ch.type === c.type)) {
                await guild.channels.create({
                    name: c.name,
                    type: c.type,
                    position: c.position,
                    permissionOverwrites: resolveOverwrites(c.permissionOverwrites),
                    reason: 'Anti-Nuke Restore'
                }).catch(() => {});
            }
        }

        const channels = backupChannels.filter(c => c.type !== ChannelType.GuildCategory);
        for (const c of channels) {
            if (!guild.channels.cache.find(ch => ch.name === c.name && ch.type === c.type)) {
                const parent = c.parentName ? guild.channels.cache.find(cat => cat.name === c.parentName && cat.type === ChannelType.GuildCategory) : null;
                await guild.channels.create({
                    name: c.name,
                    type: c.type,
                    parent: parent ? parent.id : null,
                    position: c.position,
                    permissionOverwrites: resolveOverwrites(c.permissionOverwrites),
                    reason: 'Anti-Nuke Restore'
                }).catch(() => {});
                await new Promise(r => setTimeout(r, 200)); 
            }
        }

        console.log('[RESTORE] ✅ Process finished.');
        return 'SUCCESS';

    } catch (e) {
        console.error('[RESTORE ERROR]', e);
        return 'ERROR';
    } finally {
        restoringGuilds.delete(guild.id);
    }
}

// --- 2. SISTEMA DE DETECCIÓN INTELIGENTE ---
async function handleAction(guild, executorId, actionType) {
    const triggerKey = `${guild.id}_${executorId}`;
    if (triggeredUsers.has(triggerKey)) return; 

    const settings = await db.query('SELECT antinuke_enabled, threshold_count, threshold_time FROM guild_backups WHERE guildid = $1', [guild.id]);
    if (settings.rows.length === 0 || !settings.rows[0].antinuke_enabled) return;

    const { threshold_count, threshold_time } = settings.rows[0];
    const key = `${guild.id}_${executorId}_${actionType}`;
    
    if (!limitCache.has(key)) {
        limitCache.set(key, { count: 1, timer: setTimeout(() => limitCache.delete(key), threshold_time * 1000) });
        console.log(`[ANTINUKE] Monitor ${actionType} for ${executorId}`);
    } else {
        const data = limitCache.get(key);
        data.count++;
        
        if (data.count >= threshold_count) {
            clearTimeout(data.timer);
            limitCache.delete(key);
            triggeredUsers.add(triggerKey);
            setTimeout(() => triggeredUsers.delete(triggerKey), 5 * 60 * 1000);

            const user = await guild.client.users.fetch(executorId).catch(() => null);
            await triggerProtection(guild, user, actionType);
        }
    }
}

async function triggerProtection(guild, user, type) {
    console.log(`[ANTI-NUKE] 🚨 TRIGGERED by ${user?.tag} (${type})`);
    
    if (guild.members.me.permissions.has(PermissionFlagsBits.BanMembers) && user) {
        await guild.members.ban(user.id, { 
            deleteMessageSeconds: 604800, 
            reason: `Anti-Nuke: Mass ${type} Detected` 
        }).catch(e => console.error("Ban failed:", e.message));
    }

    const logRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid=$1 AND log_type='antinuke'", [guild.id]);
    if (logRes.rows.length > 0) {
        const ch = guild.channels.cache.get(logRes.rows[0].channel_id);
        if (ch) {
            ch.send({ 
                embeds: [new EmbedBuilder()
                    .setTitle('☢️ SERVER NUKE ATTEMPT BLOCKED')
                    .setDescription(`**User:** ${user?.tag}\n**Action:** Mass ${type}\n**Result:** Banned (7 days messages deleted) & Restoring Backup...`)
                    .setColor(0xFF0000)
                    .setTimestamp()
                ] 
            }).catch(()=>{});
        }
    }

    await restoreGuild(guild);
}

// --- 3. ANTI-BOT NO VERIFICADO ---
async function checkBotJoin(member) {
    if (!member.user.bot) return; 

    const settings = await db.query('SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1', [member.guild.id]);
    if (settings.rows.length === 0 || !settings.rows[0].antinuke_enabled) return;

    if (member.id === member.client.user.id) return; 

    const whitelist = await db.query('SELECT * FROM bot_whitelist WHERE guildid = $1 AND targetid = $2', [member.guild.id, member.id]);
    if (whitelist.rows.length > 0) return; 

    const user = await member.user.fetch();
    const isVerified = user.flags?.has(UserFlags.VerifiedBot);

    if (!isVerified) {
        console.log(`[ANTI-BOT] Unverified bot detected: ${member.user.tag}`);
        
        let inviterText = "Unknown (Check Logs)";
        try {
            const logs = await member.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.BotAdd });
            const entry = logs.entries.find(e => e.target.id === member.id);
            if (entry && entry.executor) {
                inviterText = `${entry.executor.tag} (\`${entry.executor.id}\`)`;
            }
        } catch (e) { console.error("Error fetching inviter:", e); }

        if (member.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
            await member.ban({ 
                deleteMessageSeconds: 604800, 
                reason: `Anti-Nuke: Unverified Bot. Invited by: ${inviterText}` 
            }).catch(() => {});
            
            const logRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid=$1 AND log_type='antinuke'", [member.guild.id]);
            if (logRes.rows.length > 0) {
                const ch = member.guild.channels.cache.get(logRes.rows[0].channel_id);
                if (ch) ch.send({ 
                    embeds: [new EmbedBuilder()
                        .setTitle('🤖 UNVERIFIED BOT BANNED')
                        .setDescription(`**Bot:** ${member.user.tag} (\`${member.id}\`)\n**Invited By:** ${inviterText}\n**Reason:** Not Verified & Not Whitelisted\n**Action:** Banned & Messages Purged`)
                        .setColor(0xFFA500)
                        .setTimestamp()
                    ] 
                }).catch(()=>{});
            }
        }
    }
}

module.exports = { createBackup, restoreGuild, handleAction, checkBotJoin };