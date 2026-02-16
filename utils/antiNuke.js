const { AuditLogEvent, PermissionFlagsBits, ChannelType, EmbedBuilder, UserFlags, OverwriteType } = require('discord.js');
const db = require('./db.js');
const { emojis, SUPREME_IDS } = require('./config.js'); 

const limitCache = new Map(); 
const triggeredUsers = new Set(); 
const restoringGuilds = new Set();
const backingUpGuilds = new Set();

const guildSettingsCache = new Map(); // guildId -> { settings, ts }
const userInfoCache = new Map(); // userId -> { bot, flags, ts }
const userNukeHistory = new Map(); // userId -> { timings: [], lastAction }
const guildStateSnapshots = new Map(); // guildId -> { channels, roles, timestamp }

const SETTINGS_TTL = 60 * 1000; // 60s cache
const USERINFO_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_TTL = 60 * 1000; // 60 segundos
const CLEANUP_INTERVAL = 30 * 1000; // Limpiar cada 30 segundos
const SNAPSHOT_INTERVAL = 3000; // Snapshots cada 3 segundos

async function validateBackup(backupData) {
    if (!backupData.channels || !Array.isArray(backupData.channels)) {
        throw new Error('Invalid backup: channels is not an array');
    }
    
    if (!backupData.roles || !Array.isArray(backupData.roles)) {
        throw new Error('Invalid backup: roles is not an array');
    }

    if (backupData.channels.length === 0 && backupData.roles.length === 0) {
        throw new Error('Invalid backup: both channels and roles are empty');
    }

    if (!backupData.timestamp || typeof backupData.timestamp !== 'number') {
        throw new Error('Invalid backup: missing or invalid timestamp');
    }

    return true;
}

async function createBackup(guild) {
    if (!guild) return false;
    if (backingUpGuilds.has(guild.id)) {
        console.log(`[BACKUP] ${emojis.warn || '⚠️'} Backup already in progress for ${guild.name}.`);
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
            permissionOverwrites: c.permissionOverwrites ? c.permissionOverwrites.cache.map(p => {
                let roleName = null;
                if (p.type === OverwriteType.Role) {
                    const role = guild.roles.cache.get(p.id);
                    if (role) roleName = role.name;
                }
                return { id: p.id, type: p.type, allow: p.allow.bitfield.toString(), deny: p.deny.bitfield.toString(), roleName: roleName };
            }) : [] 
        }));

        const roles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed).map(r => ({
            id: r.id, name: r.name, color: r.color, hoist: r.hoist, permissions: r.permissions.bitfield.toString(), position: r.position 
        }));
        
        const backupData = { 
            channels, 
            roles, 
            timestamp: Date.now(),
            guildName: guild.name,
            channelCount: channels.length,
            roleCount: roles.length
        };

        // Validar backup antes de guardar
        await validateBackup(backupData);

        // Obtener backups anteriores
        const result = await db.query(
            `SELECT backup_history FROM guild_backups WHERE guildid = $1`,
            [guild.id]
        );

        let backupHistory = [];
        if (result.rows.length > 0 && result.rows[0].backup_history) {
            try {
                backupHistory = JSON.parse(result.rows[0].backup_history);
            } catch (e) {
                backupHistory = [];
            }
        }

        // Agregar nuevo backup al inicio
        backupHistory.unshift(backupData);

        // Mantener solo últimos 3 backups
        backupHistory = backupHistory.slice(0, 3);

        // Guardar en DB
        await db.query(
            `INSERT INTO guild_backups (guildid, data, last_backup, backup_history) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (guildid) DO UPDATE SET 
             data = $2, 
             last_backup = $3,
             backup_history = $4`,
            [guild.id, backupData, Date.now(), JSON.stringify(backupHistory)]
        );

        console.log(`[BACKUP] ${emojis.success || '✅'} ${guild.name}: v${backupHistory.length} (${channels.length} channels, ${roles.length} roles)`);
        return 'SUCCESS';
    } catch (e) {
        console.error(`[BACKUP ERROR] Guild ${guild.id}:`, e);
        return 'ERROR';
    } finally { backingUpGuilds.delete(guild.id); }
}

async function restoreGuild(guild) {
    if (restoringGuilds.has(guild.id)) return 'IN_PROGRESS';
    restoringGuilds.add(guild.id);
    try {
        const result = await db.query('SELECT backup_history FROM guild_backups WHERE guildid = $1', [guild.id]);
        if (result.rows.length === 0) return 'NO_DATA';
        
        let backupHistory = [];
        if (result.rows[0].backup_history) {
            try {
                backupHistory = JSON.parse(result.rows[0].backup_history);
            } catch (e) {
                backupHistory = [];
            }
        }

        if (backupHistory.length === 0) {
            // Intenta con el backup antiguo por compatibilidad
            const legacyResult = await db.query('SELECT data FROM guild_backups WHERE guildid = $1', [guild.id]);
            if (legacyResult.rows.length === 0) return 'NO_DATA';
            backupHistory = [legacyResult.rows[0].data];
        }

        console.log(`[RESTORE] ${emojis.warn || '🛡️'} Starting restoration for ${guild.name} with ${backupHistory.length} available backup(s)...`);

        // Intentar restaurar con cada backup, comenzando por el más reciente
        for (let i = 0; i < backupHistory.length; i++) {
            const backup = backupHistory[i];
            
            try {
                const age = Math.floor((Date.now() - backup.timestamp) / 1000);
                console.log(`[RESTORE] Attempting backup ${i + 1}/${backupHistory.length} (${age}s old)...`);
                
                // Validar integridad del backup
                await validateBackup(backup);

                // Ejecutar restauración
                await performRestore(guild, backup);

                console.log(`[RESTORE] ${emojis.success || '✅'} Restoration successful using backup ${i + 1}`);
                return 'SUCCESS';
            } catch (e) {
                console.error(`[RESTORE] ❌ Backup ${i + 1} failed: ${e.message}`);
                if (i === backupHistory.length - 1) {
                    throw new Error(`All ${backupHistory.length} backups failed to restore`);
                }
                continue;
            }
        }

        return 'FAILED_ALL_BACKUPS';
    } catch (e) {
        console.error('[RESTORE ERROR]', e);
        return 'ERROR';
    } finally { restoringGuilds.delete(guild.id); }
}

async function performRestore(guild, backup) {
    const { roles: backupRoles, channels: backupChannels } = backup;

    // Paso 1: Limpiar roles que no estaban en el backup
    const currentRoles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed && r.editable);
    for (const role of currentRoles.values()) {
        const isInBackup = backupRoles.some(br => br.name === role.name); 
        if (!isInBackup) await role.delete('Anti-Nuke Cleanup').catch(() => {});
    }

    // Paso 2: Limpiar canales que no estaban en el backup
    const currentChannels = guild.channels.cache.filter(c => c.deletable);
    for (const channel of currentChannels.values()) {
        const isInBackup = backupChannels.some(bc => bc.name === channel.name && bc.type === channel.type);
        if (!isInBackup) await channel.delete('Anti-Nuke Cleanup').catch(() => {});
    }

    // Paso 3: Restaurar roles
    backupRoles.sort((a, b) => b.position - a.position);
    for (const r of backupRoles) {
        const exists = guild.roles.cache.find(role => role.name === r.name);
        if (!exists) {
            await guild.roles.create({ name: r.name, color: r.color, hoist: r.hoist, permissions: BigInt(r.permissions), position: r.position, reason: 'Anti-Nuke Restore' }).catch(() => {});
        }
    }

    // Paso 4: Restaurar canales
    const resolveOverwrites = (savedOverwrites) => {
        if (!savedOverwrites) return []; 
        return savedOverwrites.map(o => {
            let targetId = o.id; 
            if (o.type === OverwriteType.Role) {
                if (o.roleName === '@everyone') targetId = guild.roles.everyone.id;
                else if (o.roleName) {
                    const newRole = guild.roles.cache.find(r => r.name === o.roleName);
                    if (newRole) targetId = newRole.id;
                    else return null; 
                }
            }
            return { id: targetId, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) };
        }).filter(o => o !== null); 
    };

    const categories = backupChannels.filter(c => c.type === ChannelType.GuildCategory);
    for (const c of categories) {
        if (!guild.channels.cache.find(ch => ch.name === c.name && ch.type === c.type)) {
            await guild.channels.create({ name: c.name, type: c.type, position: c.position, permissionOverwrites: resolveOverwrites(c.permissionOverwrites), reason: 'Anti-Nuke Restore' }).catch(() => {});
        }
    }

    const channels = backupChannels.filter(c => c.type !== ChannelType.GuildCategory);
    for (const c of channels) {
        if (!guild.channels.cache.find(ch => ch.name === c.name && ch.type === c.type)) {
            const parent = c.parentName ? guild.channels.cache.find(cat => cat.name === c.parentName && cat.type === ChannelType.GuildCategory) : null;
            await guild.channels.create({ name: c.name, type: c.type, parent: parent ? parent.id : null, position: c.position, permissionOverwrites: resolveOverwrites(c.permissionOverwrites), reason: 'Anti-Nuke Restore' }).catch(() => {});
            await new Promise(r => setTimeout(r, 200)); 
        }
    }
}

async function handleAction(guild, executorId, actionType) {
    const triggerKey = `${guild.id}_${executorId}`;
    if (triggeredUsers.has(triggerKey)) return; 
    const settingsObj = await getGuildSettings(guild.id);
    if (!settingsObj || !settingsObj.antinuke_enabled) return;

    const { threshold_count, threshold_time, antinuke_ignore_supreme, antinuke_ignore_verified } = settingsObj;

    if (antinuke_ignore_supreme && SUPREME_IDS.includes(executorId)) return;

    const uinfo = await getUserInfo(guild.client, executorId).catch(() => null);
    if (uinfo && uinfo.bot && antinuke_ignore_verified) {
        if (uinfo.flags && uinfo.flags.has && uinfo.flags.has('VerifiedBot')) return;
    }
    
    const key = `${guild.id}_${executorId}_${actionType}`;
    
    if (!limitCache.has(key)) {
        const timer = setTimeout(() => limitCache.delete(key), threshold_time * 1000);
        limitCache.set(key, { 
            count: 1, 
            timer, 
            createdAt: Date.now(),
            actions: [{ time: Date.now(), type: actionType }]
        });
    } else {
        const data = limitCache.get(key);
        data.count++;
        data.actions.push({ time: Date.now(), type: actionType });
        
        if (data.count >= threshold_count) {
            clearTimeout(data.timer);
            limitCache.delete(key);
            
            /** MEJORA #3: Cooldown Progresivo */
            const cooldown = await calculateDynamicCooldown(executorId);
            triggeredUsers.add(triggerKey);
            setTimeout(() => triggeredUsers.delete(triggerKey), cooldown);

            const user = await guild.client.users.fetch(executorId).catch(() => null);
            const attackCount = await recordNukeAttempt(executorId);
            
            await triggerProtection(guild, user, actionType, attackCount);
        }
    }
}

/** MEJORA #3: Cooldown Progresivo */
async function calculateDynamicCooldown(executorId) {
    const history = userNukeHistory.get(executorId);
    if (!history || history.timings.length === 0) return 5 * 60 * 1000; // 5 minutos (primera vez)

    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);

    // Limpiar eventos de hace más de 24h
    history.timings = history.timings.filter(t => t > oneDayAgo);

    const timingsInDay = history.timings.length;

    if (timingsInDay === 1) return 15 * 60 * 1000;   // 15 min, segunda vez
    if (timingsInDay === 2) return 30 * 60 * 1000;   // 30 min, tercera vez
    if (timingsInDay >= 3) return 60 * 60 * 1000;    // 1 hora, cuarta+ vez

    return 5 * 60 * 1000;
}

/** MEJORA #3: Registrar intento de nuke */
async function recordNukeAttempt(executorId) {
    let history = userNukeHistory.get(executorId);
    
    if (!history) {
        history = { timings: [], lastAction: null };
    }

    history.timings.push(Date.now());
    history.lastAction = Date.now();
    userNukeHistory.set(executorId, history);

    return history.timings.length;
}

async function getGuildSettings(guildId) {
    const cached = guildSettingsCache.get(guildId);
    if (cached && (Date.now() - cached.ts) < SETTINGS_TTL) return cached.settings;
    const res = await db.query('SELECT antinuke_enabled, threshold_count, threshold_time, antinuke_ignore_supreme, antinuke_ignore_verified, antinuke_action FROM guild_backups WHERE guildid = $1', [guildId]);
    if (res.rows.length === 0) return null;
    const settings = res.rows[0];
    guildSettingsCache.set(guildId, { settings, ts: Date.now() });
    return settings;
}

async function getUserInfo(client, userId) {
    const cached = userInfoCache.get(userId);
    if (cached && (Date.now() - cached.ts) < USERINFO_TTL) return cached.info;
    let user = client.users.cache.get(userId) || null;
    if (!user) {
        try { user = await client.users.fetch(userId); } catch (e) { user = null; }
    }
    if (!user) return null;
    const info = { bot: user.bot, flags: user.flags };
    userInfoCache.set(userId, { info, ts: Date.now() });
    return info;
}

async function triggerProtection(guild, user, type, attackCount = 1) {
    console.log(`[ANTI-NUKE] ${emojis.warn || '🚨'} TRIGGERED by ${user?.tag} (${type}) - Attack #${attackCount}`);
    
    const banReason = attackCount >= 3 
        ? `Anti-Nuke: Repeated nuke attempts (${attackCount}x in 24h) - PERMANENT BAN`
        : `Anti-Nuke: Mass ${type} Detected`;

    if (guild.members.me.permissions.has(PermissionFlagsBits.BanMembers) && user) {
        await guild.members.ban(user.id, { deleteMessageSeconds: 604800, reason: banReason }).catch(e => console.error("Ban failed:", e.message));
    }

    const logRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid=$1 AND log_type='antinuke'", [guild.id]);
    if (logRes.rows.length > 0) {
        const ch = guild.channels.cache.get(logRes.rows[0].channel_id);
        if (ch) {
            const embed = new EmbedBuilder()
                .setTitle('🚨 Server Nuke Detected')
                .setDescription(`User: ${user?.tag || 'Unknown'}\nAction: Mass ${type}\nAttempt: #${attackCount} in 24h\nResult: User banned and server restored.`)
                .setColor(attackCount >= 3 ? 0x7F1D1D : 0xB00020)
                .setFooter({ text: 'Anti-Nuke Protection' })
                .setTimestamp();
            ch.send({ embeds: [embed] }).catch(() => {});
        }
    }
    await restoreGuild(guild);
}

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
        let inviterText = "Unknown (Check Logs)";
        try {
            const logs = await member.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.BotAdd });
            const entry = logs.entries.find(e => e.target.id === member.id);
            if (entry && entry.executor) inviterText = `${entry.executor.tag} (\`${entry.executor.id}\`)`;
        } catch (e) { }

        if (member.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
            await member.ban({ deleteMessageSeconds: 604800, reason: `Anti-Nuke: Unverified Bot. Invited by: ${inviterText}` }).catch(() => {});
            
            const logRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid=$1 AND log_type='antinuke'", [member.guild.id]);
            if (logRes.rows.length > 0) {
                const ch = member.guild.channels.cache.get(logRes.rows[0].channel_id);
                if (ch) {
                    const embed = new EmbedBuilder()
                        .setTitle('Unverified Bot Removed')
                        .setDescription(`Bot: ${member.user.tag} (${member.id})\nInvited By: ${inviterText}\nReason: Not verified and not whitelisted.`)
                        .setColor(0xD97706)
                        .setFooter({ text: 'Anti-Nuke' })
                        .setTimestamp();
                    ch.send({ embeds: [embed] }).catch(() => {});
                }
            }
        }
    }
}

/** MEJORA #2: Snapshot del estado del servidor (detectar cambios masivos) */
async function snapshotGuildState(guild) {
    const snapshot = {
        channels: guild.channels.cache.map(c => ({ id: c.id, name: c.name, type: c.type })),
        roles: guild.roles.cache.map(r => ({ id: r.id, name: r.name })),
        timestamp: Date.now()
    };
    return snapshot;
}

async function detectMassChanges(guild) {
    const current = await snapshotGuildState(guild);
    const previous = guildStateSnapshots.get(guild.id);

    if (!previous) {
        guildStateSnapshots.set(guild.id, current);
        return null;
    }

    const deletedChannels = previous.channels.filter(
        pc => !current.channels.find(cc => cc.id === pc.id)
    );

    const createdRoles = current.roles.filter(
        cr => !previous.roles.find(pr => pr.id === cr.id)
    );

    guildStateSnapshots.set(guild.id, current);

    const timeDiff = (current.timestamp - previous.timestamp) / 1000; // segundos

    if (timeDiff > 0) {
        const deleteRate = deletedChannels.length / timeDiff;
        const createRate = createdRoles.length / timeDiff;

        // Si hay más de 2 cambios por segundo, es muy sospechoso
        if (deleteRate > 2 || createRate > 2) {
            console.log(`[SNAPSHOT] ${emojis.warn || '⚠️'} SUSPICIOUS: Guild ${guild.name} | Deleted: ${deletedChannels.length}/${deleteRate.toFixed(2)}/s | Created: ${createdRoles.length}/${createRate.toFixed(2)}/s`);
            return {
                deletedChannels,
                createdRoles,
                rate: Math.max(deleteRate, createRate),
                timeDiff,
                suspicious: true
            };
        }
    }

    return null;
}

/** MEJORA #7: Cleanup automático de caché */
function startCacheCleanup() {
    setInterval(() => {
        const now = Date.now();
        let cleaned = 0;
        const totalSize = limitCache.size;

        for (const [key, data] of limitCache.entries()) {
            const age = now - (data.createdAt || now - CACHE_MAX_TTL + 1000);

            if (age > CACHE_MAX_TTL) {
                if (data.timer) clearTimeout(data.timer);
                limitCache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0 && process.env.DEBUG_ANTINUKE) {
            console.log(`[CACHE CLEANUP] Removed ${cleaned}/${totalSize} stale entries`);
        }
    }, CLEANUP_INTERVAL);

    console.log('[ANTI-NUKE] Cache cleanup started (interval: ' + CLEANUP_INTERVAL + 'ms, TTL: ' + CACHE_MAX_TTL + 'ms)');
}

// Iniciar cleanup automático
startCacheCleanup();

module.exports = { createBackup, restoreGuild, handleAction, checkBotJoin, snapshotGuildState, detectMassChanges };
